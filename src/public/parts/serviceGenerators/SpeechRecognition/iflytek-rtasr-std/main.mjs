/**
 * @typedef {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionSource_t} SpeechRecognitionSource_t
 */

import { hmacSha1Base64, md5Hex } from '../shared/iflytekAuth.mjs'
import { attenuatePcm16 } from '../shared/pcm.mjs'
import { buildSourceInfo, extractRtasrText, openWs, runRecognizeInput } from '../shared/recognizeHelpers.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

const FRAME_SIZE = 1280

/**
 * 讯飞实时转写标准版流式语音识别生成器。
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
	name: 'iflytek-rtasr-std',
	app_id: '',
	api_key: '',
	lang: 'cn',
	pd: '',
}

/**
 * @param {number} ms 毫秒
 * @param {AbortSignal} [signal] 中止
 * @returns {Promise<void>}
 */
function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		/**
		 * @returns {void}
		 */
		const onAbort = () => {
			clearTimeout(timer)
			reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort)
			resolve()
		}, ms)
		signal?.addEventListener('abort', onAbort)
	})
}

/**
 * @param {object} config 配置
 * @returns {Promise<SpeechRecognitionSource_t>} 源
 */
async function GetSource(config) {
	const appId = config.app_id
	const apiKey = config.api_key
	const lang = config.lang || config.language || configTemplate.lang
	const pd = config.pd || ''

	return {
		type: 'speech-recognition',
		info: buildSourceInfo(product_info, { name: config.name || 'iFlytek RTASR Std', provider: 'iflytek' }),
		is_paid: true,
		extension: {},
		/**
		 * @param {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionOptions_t} options 选项
		 * @returns {Promise<import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionResult_t>} 结果
		 */
		Recognize: async (options) => {
			const ts = String(Math.floor(Date.now() / 1000))
			const signa = hmacSha1Base64(apiKey, md5Hex(appId + ts))
			const q = new URLSearchParams({ appid: appId, ts, signa })
			if (lang) q.set('lang', lang)
			if (pd) q.set('pd', pd)
			const ws = await openWs(`wss://rtasr.xfyun.cn/v1/ws?${q}`, { binaryType: 'arraybuffer' })

			let lastText = ''
			/** @type {(v: string) => void} */
			let resolveFinal
			/** @type {(e: Error) => void} */
			let rejectFinal
			const finalPromise = new Promise((resolve, reject) => {
				resolveFinal = resolve
				rejectFinal = reject
			})
			let settled = false
			/**
			 * @param {string} text 终稿
			 * @returns {void}
			 */
			const finish = (text) => {
				if (settled) return
				settled = true
				resolveFinal(text)
			}
			/**
			 * @param {Error} err 错误
			 * @returns {void}
			 */
			const fail = (err) => {
				if (settled) return
				settled = true
				rejectFinal(err)
			}
			/**
			 * @returns {void}
			 */
			const onAbort = () => {
				fail(options.signal?.reason instanceof Error ? options.signal.reason : new Error('aborted'))
				ws.close()
			}
			options.signal?.addEventListener('abort', onAbort, { once: true })

			ws.addEventListener('message', (ev) => {
				const raw = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)
				let msg
				try { msg = JSON.parse(raw) }
				catch { return }
				if (msg.action === 'error' || (msg.code && msg.code !== '0')) {
					fail(new Error(`讯飞RTASR标准版错误 ${msg.code}: ${msg.desc || ''}`))
					return
				}
				if (msg.action === 'started') return
				if (!msg.data) return
				let resultData
				try { resultData = JSON.parse(msg.data) }
				catch { return }
				const piece = extractRtasrText(resultData)
				const isFinal = !!resultData.ls
				if (piece) lastText += piece
				if (piece || isFinal)
					options.onResult?.({ text: lastText, isFinal })
				if (isFinal) finish(lastText)
			})
			ws.addEventListener('error', () => fail(new Error('WebSocket error')))
			ws.addEventListener('close', () => {
				if (!settled) finish(lastText)
			})

			try {
				await runRecognizeInput(options, {
					/**
					 * @param {Uint8Array} chunk PCM
					 * @param {boolean} isLast 是否末帧
					 * @returns {Promise<void>}
					 */
					onSend: async (chunk, isLast) => {
						const pcm = attenuatePcm16(chunk)
						for (let offset = 0; offset < pcm.byteLength;) {
							const end = Math.min(offset + FRAME_SIZE, pcm.byteLength)
							ws.send(pcm.subarray(offset, end))
							offset = end
							if (offset < pcm.byteLength) await sleep(40, options.signal)
						}
						if (isLast)
							ws.send('{"end": "true"}')
					},
				})
				const text = await finalPromise
				return { text, language: options.language }
			}
			finally {
				options.signal?.removeEventListener('abort', onAbort)
				try { ws.close() } catch { /* ignore */ }
			}
		},
		interfaces: {}
	}
}
