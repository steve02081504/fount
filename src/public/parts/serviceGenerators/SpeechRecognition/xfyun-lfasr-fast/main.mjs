/**
 * @typedef {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionSource_t} SpeechRecognitionSource_t
 */

import { concatUint8, pcmToWav } from '../shared/pcm.mjs'
import { buildSourceInfo, recognizeByBuffering } from '../shared/recognizeHelpers.mjs'
import { hmacSha256Base64, sha256Base64 } from '../shared/xfyunAuth.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

const UPLOAD_HOST = 'upload-ost-api.xfyun.cn'
const OST_HOST = 'ost-api.xfyun.cn'
const LARGE_FILE_THRESHOLD = 30_000_000
const MULTIPART_CHUNK_SIZE = 5 * 1024 * 1024

/**
 * 讯飞极速转写批式语音识别生成器。
 * @type {import('../../../../../decl/SpeechRecognitionSourceGenerator.ts').SpeechRecognitionSourceGenerator_t}
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * @returns {Promise<object>} 模板
			 */
			GetConfigTemplate: async () => configTemplate,
			GetSource,
		}
	}
}

const configTemplate = {
	name: 'xfyun-lfasr-fast',
	app_id: '',
	api_key: '',
	api_secret: '',
	pd: '',
}

/**
 * 解析 JSON 字段：已是对象则原样返回，字符串才 JSON.parse。
 * @param {string | object} value 值
 * @returns {object | undefined} 对象
 */
function parseJsonField(value) {
	if (!value) return undefined
	if (typeof value !== 'string') return value
	try { return JSON.parse(value) }
	catch { return undefined }
}

/**
 * 解析 lattice / 极速结果文本。
 * @param {string | object} result 结果（对象或 JSON 字符串）
 * @returns {string} 文本
 */
function parseFastResult(result) {
	const parsed = parseJsonField(result)
	if (!parsed) return typeof result === 'string' ? result : ''
	let text = ''
	for (const item of parsed.lattice || []) {
		const best = parseJsonField(item.json_1best)
		if (!best) continue
		for (const recognitionResult of best.st?.rt || [])
			for (const wordSegment of recognitionResult.ws || [])
				for (const candidateWord of wordSegment.cw || [])
					text += candidateWord.w || ''
	}
	return text
}

/**
 * 构造 multipart/form-data 请求体。
 * @param {{ name: string, value: string | Uint8Array, filename?: string, ctype?: string }[]} fields 字段
 * @returns {{ boundary: string, bodyBytes: Uint8Array }} 请求体
 */
function buildMultipartForm(fields) {
	const boundary = '----fount' + crypto.randomUUID().replace(/-/g, '')
	const parts = []
	for (const { name, value, filename, ctype } of fields) {
		let head = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"`
		if (filename) head += `; filename="${filename}"`
		if (ctype) head += `\r\nContent-Type: ${ctype}`
		head += '\r\n\r\n'
		parts.push(new TextEncoder().encode(head))
		parts.push(typeof value === 'string' ? new TextEncoder().encode(value) : value)
		parts.push(new TextEncoder().encode('\r\n'))
	}
	parts.push(new TextEncoder().encode(`--${boundary}--\r\n`))
	return { boundary, bodyBytes: concatUint8(parts) }
}

/**
 * Digest + HMAC-SHA256 鉴权头。
 * @param {{ host: string, path: string, apiKey: string, apiSecret: string, body: Uint8Array | string }} opts 参数
 * @returns {{ date: string, digest: string, authorization: string }} 头
 */
function buildDigestAuth({ host, path, apiKey, apiSecret, body }) {
	const date = new Date().toUTCString()
	const digest = `SHA-256=${sha256Base64(body)}`
	const signOrigin = `host: ${host}\ndate: ${date}\nPOST ${path} HTTP/1.1\ndigest: ${digest}`
	const signature = hmacSha256Base64(apiSecret, signOrigin)
	const authorization = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line digest", signature="${signature}"`
	return { date, digest, authorization }
}

/**
 * @param {number} ms 毫秒
 * @param {AbortSignal} [signal] 中止
 * @returns {Promise<void>}
 */
function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms)
		signal?.addEventListener('abort', () => {
			clearTimeout(timer)
			reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
		}, { once: true })
	})
}

/**
 * 小文件（<30M）直传。
 * @param {Uint8Array} wav WAV 数据
 * @param {{ appId: string, apiKey: string, apiSecret: string, requestId: string, signal?: AbortSignal }} ctx 上下文
 * @returns {Promise<string>} 音频地址
 */
async function uploadSmallAudio(wav, { appId, apiKey, apiSecret, requestId, signal }) {
	const { boundary, bodyBytes } = buildMultipartForm([
		{ name: 'data', value: wav, filename: 'audio.wav', ctype: 'application/octet-stream' },
		{ name: 'app_id', value: appId },
		{ name: 'request_id', value: requestId },
	])
	const auth = buildDigestAuth({ host: UPLOAD_HOST, path: '/file/upload', apiKey, apiSecret, body: bodyBytes })
	const resp = await fetch(`https://${UPLOAD_HOST}/file/upload`, {
		method: 'POST',
		headers: {
			Host: UPLOAD_HOST,
			Date: auth.date,
			Digest: auth.digest,
			Authorization: auth.authorization,
			'Content-Type': `multipart/form-data; boundary=${boundary}`,
		},
		body: bodyBytes,
		signal,
	})
	const json = JSON.parse(await resp.text())
	if (json.code !== 0)
		throw new Error(`lfasr-fast upload error ${json.code}: ${json.message || ''}`)
	return json.data?.url
}

/**
 * 大文件（≥30M）分块上传：init → 逐块 upload → complete。
 * @param {Uint8Array} wav WAV 数据
 * @param {{ appId: string, apiKey: string, apiSecret: string, requestId: string, signal?: AbortSignal }} ctx 上下文
 * @returns {Promise<string>} 音频地址
 */
async function uploadLargeAudio(wav, { appId, apiKey, apiSecret, requestId, signal }) {
	/**
	 * @param {string} path 路径
	 * @param {object} bodyObj 请求体对象
	 * @returns {Promise<object>} 响应 JSON
	 */
	const postJson = async (path, bodyObj) => {
		const body = JSON.stringify(bodyObj)
		const auth = buildDigestAuth({ host: UPLOAD_HOST, path, apiKey, apiSecret, body })
		const resp = await fetch(`https://${UPLOAD_HOST}${path}`, {
			method: 'POST',
			headers: {
				Host: UPLOAD_HOST,
				Date: auth.date,
				Digest: auth.digest,
				Authorization: auth.authorization,
				'Content-Type': 'application/json',
			},
			body,
			signal,
		})
		return JSON.parse(await resp.text())
	}

	const initJson = await postJson('/file/mpupload/init', { app_id: appId, request_id: requestId })
	if (initJson.code !== 0)
		throw new Error(`lfasr-fast mpupload init error ${initJson.code}: ${initJson.message || ''}`)
	const uploadId = initJson.data?.upload_id

	let sliceId = 0
	for (let offset = 0; offset < wav.byteLength; offset += MULTIPART_CHUNK_SIZE) {
		sliceId++
		const chunk = wav.subarray(offset, Math.min(offset + MULTIPART_CHUNK_SIZE, wav.byteLength))
		const { boundary, bodyBytes } = buildMultipartForm([
			{ name: 'app_id', value: appId },
			{ name: 'request_id', value: requestId },
			{ name: 'upload_id', value: uploadId },
			{ name: 'slice_id', value: String(sliceId) },
			{ name: 'data', value: chunk, filename: 'audio.wav', ctype: 'application/octet-stream' },
		])
		const auth = buildDigestAuth({ host: UPLOAD_HOST, path: '/file/mpupload/upload', apiKey, apiSecret, body: bodyBytes })
		const resp = await fetch(`https://${UPLOAD_HOST}/file/mpupload/upload`, {
			method: 'POST',
			headers: {
				Host: UPLOAD_HOST,
				Date: auth.date,
				Digest: auth.digest,
				Authorization: auth.authorization,
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
			},
			body: bodyBytes,
			signal,
		})
		const json = JSON.parse(await resp.text())
		if (json.code !== 0)
			throw new Error(`lfasr-fast mpupload chunk error ${json.code}: ${json.message || ''}`)
	}

	const completeJson = await postJson('/file/mpupload/complete', { app_id: appId, request_id: requestId, upload_id: uploadId })
	if (completeJson.code !== 0)
		throw new Error(`lfasr-fast mpupload complete error ${completeJson.code}: ${completeJson.message || ''}`)
	return completeJson.data?.url
}

/**
 * @param {object} config 配置
 * @returns {Promise<SpeechRecognitionSource_t>} 源
 */
async function GetSource(config) {
	const appId = config.app_id
	const apiKey = config.api_key
	const apiSecret = config.api_secret
	const pd = config.pd || ''

	return {
		type: 'speech-recognition',
		info: buildSourceInfo(product_info, { name: config.name || 'Xfyun LFASR Fast', provider: 'xfyun' }),
		is_paid: true,
		extension: {},
		/**
		 * @param {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionOptions_t} options 选项
		 * @returns {Promise<import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionResult_t>} 结果
		 */
		Recognize: async (options) => recognizeByBuffering(options, async (pcm) => {
			const wav = pcmToWav(pcm)
			const durationSec = Math.max(1, Math.floor(pcm.byteLength / 32000))
			const requestId = String(Date.now()) + String(Math.random()).slice(2)

			const audioUrl = wav.byteLength >= LARGE_FILE_THRESHOLD
				? await uploadLargeAudio(wav, { appId, apiKey, apiSecret, requestId, signal: options.signal })
				: await uploadSmallAudio(wav, { appId, apiKey, apiSecret, requestId, signal: options.signal })

			// 创建任务
			const business = {
				request_id: requestId,
				language: 'zh_cn',
				domain: 'pro_ost_ed',
				accent: 'mandarin',
				duration: durationSec,
			}
			if (pd) business.pd = pd
			if (options.hotwords?.length) business.dhw = options.hotwords.join(',')
			const createBody = JSON.stringify({
				common: { app_id: appId },
				business,
				data: {
					audio_url: audioUrl,
					audio_src: 'http',
					audio_size: wav.byteLength,
					format: 'audio/L16;rate=16000',
					encoding: 'raw',
				},
			})
			const createAuth = buildDigestAuth({
				host: OST_HOST,
				path: '/v2/ost/pro_create',
				apiKey,
				apiSecret,
				body: createBody,
			})
			const createResp = await fetch(`https://${OST_HOST}/v2/ost/pro_create`, {
				method: 'POST',
				headers: {
					Host: OST_HOST,
					Date: createAuth.date,
					Digest: createAuth.digest,
					Authorization: createAuth.authorization,
					'Content-Type': 'application/json',
				},
				body: createBody,
				signal: options.signal,
			})
			const createJson = JSON.parse(await createResp.text())
			if (createJson.code !== 0)
				throw new Error(`lfasr-fast create error ${createJson.code}: ${createJson.message || ''}`)
			const taskId = createJson.data?.task_id

			// 轮询
			const deadline = Date.now() + 5 * 60_000
			while (Date.now() < deadline) {
				if (options.signal?.aborted)
					throw options.signal.reason instanceof Error ? options.signal.reason : new Error('aborted')
				await sleep(3000, options.signal)
				const queryBody = JSON.stringify({
					common: { app_id: appId },
					business: { task_id: taskId },
				})
				const queryAuth = buildDigestAuth({
					host: OST_HOST,
					path: '/v2/ost/query',
					apiKey,
					apiSecret,
					body: queryBody,
				})
				const queryResp = await fetch(`https://${OST_HOST}/v2/ost/query`, {
					method: 'POST',
					headers: {
						Host: OST_HOST,
						Date: queryAuth.date,
						Digest: queryAuth.digest,
						Authorization: queryAuth.authorization,
						'Content-Type': 'application/json',
					},
					body: queryBody,
					signal: options.signal,
				})
				const queryJson = JSON.parse(await queryResp.text())
				if (queryJson.code !== 0)
					throw new Error(`lfasr-fast query error ${queryJson.code}: ${queryJson.message || ''}`)
				const taskStatus = queryJson.data?.task_status
				if (taskStatus === '3' || taskStatus === '4')
					return parseFastResult(queryJson.data?.result)
			}
			throw new Error('lfasr-fast poll timeout')
		}),
		interfaces: {}
	}
}
