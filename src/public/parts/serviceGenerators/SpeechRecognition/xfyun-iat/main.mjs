/**
 * @typedef {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionSource_t} SpeechRecognitionSource_t
 */

import { bytesToBase64 } from '../shared/pcm.mjs'
import { buildSourceInfo, runRecognizeInput } from '../shared/recognizeHelpers.mjs'
import { buildXfyunHmacSha256WsUrl } from '../shared/xfyunAuth.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

const FRAME_SIZE = 1280

/**
 * 讯飞听写 IAT 流式语音识别生成器。
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
	name: 'xfyun-iat',
	app_id: '',
	api_key: '',
	api_secret: '',
	domain: 'iat',
	accent: 'mandarin',
	dwa: '',
}

/**
 * 降低音量避免削波。
 * @param {Uint8Array} pcm 输入
 * @returns {Uint8Array} 衰减后
 */
function attenuate(pcm) {
	if (pcm.byteLength < 2) return pcm
	const out = new Uint8Array(pcm.byteLength)
	for (let i = 0; i + 1 < pcm.byteLength; i += 2) {
		let v = (pcm[i] | pcm[i + 1] << 8) << 16 >> 16
		v = (v / 3) | 0
		out[i] = v & 0xff
		out[i + 1] = (v >> 8) & 0xff
	}
	return out
}

/**
 * 打开全局 WebSocket。
 * @param {string} url 地址
 * @returns {Promise<WebSocket>} 连接
 */
function openWs(url) {
	const ws = new WebSocket(url)
	return new Promise((resolve, reject) => {
		ws.addEventListener('open', () => resolve(ws), { once: true })
		ws.addEventListener('error', () => reject(new Error('WebSocket error')), { once: true })
	})
}

/**
 * 从段落表拼全文。
 * @param {Map<number, string>} segments 段
 * @returns {string} 文本
 */
function buildSegmentText(segments) {
	let maxSn = 0
	for (const sn of segments.keys()) if (sn > maxSn) maxSn = sn
	let out = ''
	for (let i = 1; i <= maxSn; i++) out += segments.get(i) || ''
	return out
}

/**
 * @param {object} config 配置
 * @returns {Promise<SpeechRecognitionSource_t>} 源
 */
async function GetSource(config) {
	const appId = config.app_id
	const apiKey = config.api_key
	const apiSecret = config.api_secret
	const domain = config.domain || configTemplate.domain
	const accent = config.accent || configTemplate.accent
	const dwa = config.dwa || ''

	return {
		type: 'speech-recognition',
		info: buildSourceInfo(product_info, { name: config.name || 'Xfyun IAT Speech Recognition', provider: 'xfyun' }),
		is_paid: true,
		extension: {},
		/**
		 * @param {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionOptions_t} options 选项
		 * @returns {Promise<import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionResult_t>} 结果
		 */
		Recognize: async (options) => {
			const url = buildXfyunHmacSha256WsUrl({
				host: 'iat-api.xfyun.cn',
				path: '/v2/iat',
				apiKey,
				apiSecret,
			})
			const ws = await openWs(url)

			let lastText = ''
			let seq = 0
			/** @type {Map<number, string>} */
			const segments = new Map()
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
				let msg
				try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)) }
				catch { return }
				if (msg.code !== 0) {
					fail(new Error(`讯飞IAT错误 ${msg.code}: ${msg.message || ''}`))
					return
				}
				if (!msg.data?.result) return
				const isFinal = msg.data.status === 2
				let piece = ''
				for (const wsItem of msg.data.result.ws || [])
					for (const cw of wsItem.cw || [])
						piece += cw.w || ''
				if (!piece) {
					if (isFinal) finish(lastText)
					return
				}
				const { pgs, rg, sn } = msg.data.result
				if (pgs === 'rpl' && Array.isArray(rg) && rg.length >= 2) {
					for (let i = rg[0]; i <= rg[1]; i++) segments.delete(i)
					segments.set(sn, piece)
					lastText = buildSegmentText(segments)
				}
				else if (pgs === 'apd') {
					segments.set(sn, piece)
					lastText = buildSegmentText(segments)
				}
				else
					lastText += piece
				options.onResult?.({ text: lastText, isFinal })
				if (isFinal) finish(lastText)
			})
			ws.addEventListener('error', () => fail(new Error('WebSocket error')))
			ws.addEventListener('close', () => {
				if (!settled) finish(lastText)
			})

			/**
			 * @param {Uint8Array | null} pcm 帧
			 * @param {number} status 状态
			 * @returns {void}
			 */
			const sendFrame = (pcm, status) => {
				seq++
				/** @type {Record<string, unknown>} */
				const frame = {
					data: {
						status,
						format: 'audio/L16;rate=16000',
						encoding: 'raw',
						audio: bytesToBase64(pcm || new Uint8Array(0)),
					},
				}
				if (seq === 1) {
					frame.common = { app_id: appId }
					const business = {
						language: 'zh_cn',
						domain,
						accent,
						eos: 6000,
					}
					if (dwa) business.dwa = dwa
					if (options.hotwords?.length)
						business.dhw = options.hotwords.join(',')
					frame.business = business
				}
				ws.send(JSON.stringify(frame))
			}

			try {
				await runRecognizeInput(options, {
					/**
					 * @param {Uint8Array} chunk PCM
					 * @param {boolean} isLast 是否末帧
					 * @returns {Promise<void>}
					 */
					onSend: async (chunk, isLast) => {
						const pcm = attenuate(chunk)
						if (!pcm.byteLength && isLast) {
							seq++
							ws.send(JSON.stringify({ data: { status: 2 } }))
							return
						}
						for (let offset = 0; offset < pcm.byteLength;) {
							const end = Math.min(offset + FRAME_SIZE, pcm.byteLength)
							const piece = pcm.subarray(offset, end)
							offset = end
							let status = 1
							if (seq === 0) status = 0
							if (isLast && offset >= pcm.byteLength) status = 2
							sendFrame(piece, status)
						}
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
