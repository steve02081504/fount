/**
 * @typedef {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionSource_t} SpeechRecognitionSource_t
 */

import { hmacSha1Base64, md5Hex } from '../shared/iflytekAuth.mjs'
import { pcmToWav } from '../shared/pcm.mjs'
import { buildSourceInfo, recognizeByBuffering } from '../shared/recognizeHelpers.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 讯飞录音转写（标准版）批式语音识别生成器。
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
	name: 'iflytek-lfasr',
	app_id: '',
	api_key: '',
	api_secret: '',
	language: 'cn',
	pd: '',
}

/**
 * 解析 lattice 结果文本。
 * @param {string} orderResult 订单结果 JSON
 * @returns {string} 文本
 */
function parseLatticeResult(orderResult) {
	if (!orderResult) return ''
	const result = JSON.parse(orderResult)
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
	const apiSecret = config.api_secret
	const language = config.language || configTemplate.language
	const pd = config.pd || ''

	/**
	 * @param {string} ts 时间戳
	 * @returns {string} 签名
	 */
	const standardSigna = (ts) => hmacSha1Base64(apiSecret, md5Hex(appId + ts))

	return {
		type: 'speech-recognition',
		info: buildSourceInfo(product_info, { name: config.name || 'iFlytek LFASR', provider: 'iflytek' }),
		is_paid: true,
		extension: {},
		/**
		 * @param {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionOptions_t} options 选项
		 * @returns {Promise<import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionResult_t>} 结果
		 */
		Recognize: async (options) => recognizeByBuffering(options, async (pcm) => {
			const wav = pcmToWav(pcm)
			const durationSec = Math.max(1, Math.floor(pcm.byteLength / 32000))
			const ts = String(Math.floor(Date.now() / 1000))
			const signa = standardSigna(ts)
			const uploadUrl = new URL('https://raasr.xfyun.cn/v2/api/upload')
			uploadUrl.searchParams.set('duration', String(durationSec))
			uploadUrl.searchParams.set('signa', signa)
			uploadUrl.searchParams.set('fileName', 'audio.wav')
			uploadUrl.searchParams.set('fileSize', String(wav.byteLength))
			uploadUrl.searchParams.set('appId', appId)
			uploadUrl.searchParams.set('ts', ts)
			uploadUrl.searchParams.set('language', language)
			uploadUrl.searchParams.set('standardWav', '1')
			if (pd) uploadUrl.searchParams.set('pd', pd)
			if (options.hotwords?.length)
				uploadUrl.searchParams.set('hotWord', options.hotwords.join('|'))

			const uploadResp = await fetch(uploadUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/octet-stream' },
				body: wav,
				signal: options.signal,
			})
			const uploadBody = await uploadResp.text()
			const uploadJson = JSON.parse(uploadBody)
			if (uploadJson.code !== '000000')
				throw new Error(`lfasr upload error ${uploadJson.code}: ${uploadJson.descInfo || uploadBody}`)
			const orderId = uploadJson.content?.orderId

			const deadline = Date.now() + 5 * 60_000
			while (Date.now() < deadline) {
				if (options.signal?.aborted)
					throw options.signal.reason instanceof Error ? options.signal.reason : new Error('aborted')
				await sleep(3000, options.signal)
				const pollTs = String(Math.floor(Date.now() / 1000))
				const pollSigna = standardSigna(pollTs)
				const pollUrl = new URL('https://raasr.xfyun.cn/v2/api/getResult')
				pollUrl.searchParams.set('signa', pollSigna)
				pollUrl.searchParams.set('orderId', orderId)
				pollUrl.searchParams.set('appId', appId)
				pollUrl.searchParams.set('ts', pollTs)
				const pollResp = await fetch(pollUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'multipart/form-data' },
					signal: options.signal,
				})
				const pollJson = JSON.parse(await pollResp.text())
				if (pollJson.code !== '000000') continue
				const status = pollJson.content?.orderInfo?.status
				if (status === 4)
					return parseLatticeResult(pollJson.content?.orderResult || '')
				if (status === -1)
					throw new Error('lfasr transcribe failed')
			}
			throw new Error('lfasr poll timeout')
		}),
		interfaces: {}
	}
}
