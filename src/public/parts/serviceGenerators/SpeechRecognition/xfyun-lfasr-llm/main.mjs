/**
 * @typedef {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionSource_t} SpeechRecognitionSource_t
 */

import { pcmToWav } from '../shared/pcm.mjs'
import { buildSourceInfo, recognizeByBuffering } from '../shared/recognizeHelpers.mjs'
import { formatUtcPlus8, hmacSha1Base64 } from '../shared/xfyunAuth.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 讯飞转写大模型批式语音识别生成器。
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
	name: 'xfyun-lfasr-llm',
	app_id: '',
	api_key: '',
	api_secret: '',
	language: 'autodialect',
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
 * 大模型签名：排序后 `k=urlEncode(v)` 再 HMAC-SHA1。
 * @param {Record<string, string>} params 参数
 * @param {string} secret 密钥
 * @returns {string} 签名
 */
function largeModelSignature(params, secret) {
	const parts = Object.keys(params).filter(k => k !== 'signature' && params[k] !== '').sort()
		.map(k => `${k}=${encodeURIComponent(params[k]).replace(/%20/g, '+')}`)
	return hmacSha1Base64(secret, parts.join('&'))
}

/**
 * 随机串。
 * @param {number} n 长度
 * @returns {string} 串
 */
function randomString(n) {
	const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
	let out = ''
	const bytes = crypto.getRandomValues(new Uint8Array(n))
	for (const b of bytes) out += letters[b % letters.length]
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
	const accessKeyId = config.api_key
	const apiSecret = config.api_secret
	const language = config.language || configTemplate.language
	const pd = config.pd || ''

	return {
		type: 'speech-recognition',
		info: buildSourceInfo(product_info, { name: config.name || 'Xfyun LFASR LLM', provider: 'xfyun' }),
		is_paid: true,
		extension: {},
		/**
		 * @param {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionOptions_t} options 选项
		 * @returns {Promise<import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionResult_t>} 结果
		 */
		Recognize: async (options) => recognizeByBuffering(options, async (pcm) => {
			const wav = pcmToWav(pcm)
			const durationMs = Math.floor(pcm.byteLength / 32)
			const signatureRandom = randomString(16)
			const params = {
				accessKeyId,
				dateTime: formatUtcPlus8(),
				duration: String(durationMs),
				fileName: 'audio.wav',
				fileSize: String(wav.byteLength),
				language,
				signatureRandom,
				appId,
			}
			if (pd) params.pd = pd
			const signature = largeModelSignature(params, apiSecret)
			params.signature = signature
			const uploadUrl = 'https://office-api-ist-dx.iflyaisol.com/v2/upload?' + new URLSearchParams(params)

			const uploadResp = await fetch(uploadUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/octet-stream',
					signature,
				},
				body: wav,
				signal: options.signal,
			})
			const uploadJson = JSON.parse(await uploadResp.text())
			if (uploadJson.code !== '000000')
				throw new Error(`lfasr-llm upload error ${uploadJson.code}: ${uploadJson.descInfo || ''}`)
			const orderId = uploadJson.content?.orderId

			const deadline = Date.now() + 5 * 60_000
			while (Date.now() < deadline) {
				if (options.signal?.aborted)
					throw options.signal.reason instanceof Error ? options.signal.reason : new Error('aborted')
				await sleep(3000, options.signal)
				const pollParams = {
					accessKeyId,
					dateTime: formatUtcPlus8(),
					orderId,
					resultType: 'transfer',
					signatureRandom,
				}
				const pollSig = largeModelSignature(pollParams, apiSecret)
				pollParams.signature = pollSig
				const pollUrl = 'https://office-api-ist-dx.iflyaisol.com/v2/getResult?' + new URLSearchParams(pollParams)
				const pollResp = await fetch(pollUrl, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						signature: pollSig,
					},
					body: '{}',
					signal: options.signal,
				})
				const pollJson = JSON.parse(await pollResp.text())
				if (pollJson.code !== '000000') continue
				const status = pollJson.content?.orderInfo?.status
				if (status === 4)
					return parseLatticeResult(pollJson.content?.orderResult || '')
				if (status === -1)
					throw new Error('lfasr-llm transcribe failed')
			}
			throw new Error('lfasr-llm poll timeout')
		}),
		interfaces: {}
	}
}
