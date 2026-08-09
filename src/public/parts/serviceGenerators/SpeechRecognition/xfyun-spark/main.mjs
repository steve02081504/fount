/**
 * @typedef {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionSource_t} SpeechRecognitionSource_t
 */

import { attenuatePcm16, bytesToBase64, normalizeLang } from '../shared/pcm.mjs'
import { buildSourceInfo, openWs, runRecognizeInput } from '../shared/recognizeHelpers.mjs'
import { buildXfyunHmacSha256WsUrl } from '../shared/xfyunAuth.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

const FRAME_SIZE = 1280

/**
 * 讯飞星火 IAT 流式语音识别生成器。
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
	name: 'xfyun-spark',
	app_id: '',
	api_key: '',
	api_secret: '',
	dwa: '',
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
 * 解码星火 IAT 消息，抽取分段文本与终稿标记。
 * @param {object} msg 消息
 * @returns {{ piece: string, isFinal: boolean, pgs?: string, rg?: number[], sn?: number }} 解码结果
 */
function decodePayload(msg) {
	const encoded = msg.payload?.result?.text
	const isFinal = msg.header?.status === 2
	if (!encoded) return { piece: '', isFinal }
	let decoded
	try { decoded = JSON.parse(atob(encoded)) }
	catch { return { piece: '', isFinal } }
	let piece = ''
	for (const wsItem of decoded.ws || [])
		for (const cw of wsItem.cw || [])
			piece += cw.w || ''
	return { piece, isFinal, pgs: decoded.pgs, rg: decoded.rg, sn: decoded.sn }
}

/**
 * 按分段信息合并出最新全文。
 * @param {Map<number, string>} segments 段落表
 * @param {{ piece: string, pgs?: string, rg?: number[], sn?: number }} decoded 解码结果
 * @param {string} lastText 当前全文
 * @returns {string} 合并后的全文
 */
function applySegment(segments, decoded, lastText) {
	const { piece, pgs, rg, sn } = decoded
	if (pgs === 'rpl' && Array.isArray(rg) && rg.length >= 2) {
		for (let i = rg[0]; i <= rg[1]; i++) segments.delete(i)
		segments.set(sn, piece)
		return buildSegmentText(segments)
	}
	if (pgs === 'apd') {
		segments.set(sn, piece)
		return buildSegmentText(segments)
	}
	return lastText + piece
}

/**
 * @param {object} config 配置
 * @returns {Promise<SpeechRecognitionSource_t>} 源
 */
async function GetSource(config) {
	const appId = config.app_id
	const apiKey = config.api_key
	const apiSecret = config.api_secret
	const dwa = config.dwa || ''

	return {
		type: 'speech-recognition',
		info: buildSourceInfo(product_info, { name: config.name || 'Xfyun Spark Speech Recognition', provider: 'xfyun' }),
		is_paid: true,
		extension: {},
		/**
		 * @param {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionOptions_t} options 选项
		 * @returns {Promise<import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionResult_t>} 结果
		 */
		Recognize: async (options) => {
			const url = buildXfyunHmacSha256WsUrl({
				host: 'iat.xf-yun.com',
				path: '/v1',
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
				if (msg.header?.code !== 0) {
					fail(new Error(`讯飞错误 ${msg.header?.code}: ${msg.header?.message || ''}`))
					return
				}
				const decoded = decodePayload(msg)
				if (!decoded.piece) {
					if (decoded.isFinal) finish(lastText)
					return
				}
				lastText = applySegment(segments, decoded, lastText)
				options.onResult?.({ text: lastText, isFinal: decoded.isFinal })
				if (decoded.isFinal) finish(lastText)
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
				const frame = {
					header: { app_id: appId, status },
					payload: {
						audio: {
							encoding: 'raw',
							sample_rate: 16000,
							channels: 1,
							bit_depth: 16,
							seq,
							status,
							audio: bytesToBase64(pcm || new Uint8Array(0)),
						},
					},
				}
				if (seq === 1) {
					const iat = {
						domain: 'slm',
						language: normalizeLang(options.language, 'zh_cn'),
						accent: 'mandarin',
						eos: 6000,
						result: { encoding: 'utf8', compress: 'raw', format: 'json' },
					}
					if (dwa) iat.dwa = dwa
					if (options.hotwords?.length)
						iat.dhw = `dhw=utf-8;${options.hotwords.join('|')}`
					frame.parameter = { iat }
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
						const pcm = attenuatePcm16(chunk)
						if (!pcm.byteLength && isLast) {
							sendFrame(null, 2)
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
