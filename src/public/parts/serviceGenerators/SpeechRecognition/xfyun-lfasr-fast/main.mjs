/**
 * @typedef {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionSource_t} SpeechRecognitionSource_t
 */

import { pcmToWav } from '../shared/pcm.mjs'
import { buildSourceInfo, recognizeByBuffering } from '../shared/recognizeHelpers.mjs'
import { hmacSha256Base64, sha256Base64 } from '../shared/xfyunAuth.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

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
 * 解析 lattice / 极速结果文本。
 * @param {string} resultStr 结果
 * @returns {string} 文本
 */
function parseFastResult(resultStr) {
	if (!resultStr) return ''
	let result
	try { result = JSON.parse(resultStr) }
	catch { return resultStr }
	let out = ''
	for (const item of result.lattice || []) {
		let best
		try { best = JSON.parse(item.json_1best) }
		catch { continue }
		for (const rt of best?.st?.rt || [])
			for (const ws of rt.ws || [])
				for (const cw of ws.cw || [])
					out += cw.w || ''
	}
	return out
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

			// 1) multipart 上传（自行组包以计算 digest）
			const uploadHost = 'upload-ost-api.xfyun.cn'
			const boundary = '----fount' + crypto.randomUUID().replace(/-/g, '')
			const parts = []
			/**
			 * @param {string} name 字段
			 * @param {string | Uint8Array} value 值
			 * @param {string} [filename] 文件名
			 * @param {string} [ctype] 类型
			 * @returns {void}
			 */
			const pushPart = (name, value, filename, ctype) => {
				let head = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"`
				if (filename) head += `; filename="${filename}"`
				if (ctype) head += `\r\nContent-Type: ${ctype}`
				head += '\r\n\r\n'
				parts.push(new TextEncoder().encode(head))
				parts.push(typeof value === 'string' ? new TextEncoder().encode(value) : value)
				parts.push(new TextEncoder().encode('\r\n'))
			}
			pushPart('data', wav, 'audio.wav', 'application/octet-stream')
			pushPart('app_id', appId)
			pushPart('request_id', String(Date.now()) + String(Math.random()).slice(2))
			parts.push(new TextEncoder().encode(`--${boundary}--\r\n`))
			let total = 0
			for (const p of parts) total += p.byteLength
			const bodyBytes = new Uint8Array(total)
			let off = 0
			for (const p of parts) {
				bodyBytes.set(p, off)
				off += p.byteLength
			}
			const uploadAuth = buildDigestAuth({
				host: uploadHost,
				path: '/file/upload',
				apiKey,
				apiSecret,
				body: bodyBytes,
			})
			const uploadResp = await fetch(`https://${uploadHost}/file/upload`, {
				method: 'POST',
				headers: {
					Host: uploadHost,
					Date: uploadAuth.date,
					Digest: uploadAuth.digest,
					Authorization: uploadAuth.authorization,
					'Content-Type': `multipart/form-data; boundary=${boundary}`,
				},
				body: bodyBytes,
				signal: options.signal,
			})
			const uploadJson = JSON.parse(await uploadResp.text())
			if (uploadJson.code !== 0)
				throw new Error(`lfasr-fast upload error ${uploadJson.code}: ${uploadJson.message || ''}`)
			const audioUrl = uploadJson.data?.url

			// 2) 创建任务
			const ostHost = 'ost-api.xfyun.cn'
			const business = {
				request_id: String(Date.now()) + String(Math.random()).slice(2),
				language: 'zh_cn',
				domain: 'pro_ost_ed',
				accent: 'mandarin',
				duration: durationSec,
			}
			if (pd) business.pd = pd
			if (options.hotwords?.length) business.dhw = options.hotwords.join(',')
			const createBodyObj = {
				common: { app_id: appId },
				business,
				data: {
					audio_url: audioUrl,
					audio_src: 'http',
					audio_size: wav.byteLength,
					format: 'audio/L16;rate=16000',
					encoding: 'raw',
				},
			}
			const createBody = JSON.stringify(createBodyObj)
			const createAuth = buildDigestAuth({
				host: ostHost,
				path: '/v2/ost/pro_create',
				apiKey,
				apiSecret,
				body: createBody,
			})
			const createResp = await fetch(`https://${ostHost}/v2/ost/pro_create`, {
				method: 'POST',
				headers: {
					Host: ostHost,
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

			// 3) 轮询
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
					host: ostHost,
					path: '/v2/ost/query',
					apiKey,
					apiSecret,
					body: queryBody,
				})
				const queryResp = await fetch(`https://${ostHost}/v2/ost/query`, {
					method: 'POST',
					headers: {
						Host: ostHost,
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
				const status = queryJson.data?.status
				if (status === 2)
					return parseFastResult(queryJson.data?.result || '')
				if (status === -1)
					throw new Error('lfasr-fast transcribe failed')
			}
			throw new Error('lfasr-fast poll timeout')
		}),
		interfaces: {}
	}
}
