/**
 * @typedef {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionSource_t} SpeechRecognitionSource_t
 */

import { buildSourceInfo, runRecognizeInput } from '../shared/recognizeHelpers.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 豆包 / 火山 SAUC 流式语音识别生成器。
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
	name: 'doubao',
	app_key: '',
	access_key: '',
	resource_id: 'volc.bigasr.sauc.duration',
}

/**
 * 组装豆包二进制帧。
 * @param {number} msgType 消息类型高半字节
 * @param {number} flags 标志
 * @param {number} serialization 序列化
 * @param {Uint8Array} payload 载荷
 * @returns {Uint8Array} 帧
 */
function buildFrame(msgType, flags, serialization, payload) {
	const out = new Uint8Array(8 + payload.byteLength)
	out[0] = 0x11
	out[1] = (msgType & 0xf0) | (flags & 0x0f)
	out[2] = serialization
	out[3] = 0
	const view = new DataView(out.buffer)
	view.setUint32(4, payload.byteLength)
	out.set(payload, 8)
	return out
}

/**
 * 打开带鉴权头的 WebSocket。
 * @param {string} url 地址
 * @param {Record<string, string>} headers 头
 * @returns {Promise<import('npm:ws').WebSocket>} 连接
 */
async function openHeaderWs(url, headers) {
	const { default: Ws } = await import('npm:ws')
	const ws = new Ws(url, { headers })
	await new Promise((resolve, reject) => {
		ws.once('open', resolve)
		ws.once('error', reject)
	})
	return ws
}

/**
 * @param {object} config 配置
 * @returns {Promise<SpeechRecognitionSource_t>} 源
 */
async function GetSource(config) {
	const appKey = config.app_key
	const accessKey = config.access_key
	const resourceId = config.resource_id || configTemplate.resource_id

	return {
		type: 'speech-recognition',
		info: buildSourceInfo(product_info, { name: config.name || 'Doubao Speech Recognition', provider: 'volcengine' }),
		is_paid: true,
		extension: {},
		/**
		 * @param {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionOptions_t} options 选项
		 * @returns {Promise<import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionResult_t>} 结果
		 */
		Recognize: async (options) => {
			const requestId = crypto.randomUUID()
			const ws = await openHeaderWs('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async', {
				'X-Api-App-Key': appKey,
				'X-Api-Access-Key': accessKey,
				'X-Api-Resource-Id': resourceId,
				'X-Api-Request-Id': requestId,
				'X-Api-Connect-Id': crypto.randomUUID(),
				'X-Api-Sequence': '-1',
			})

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

			ws.on('message', (raw) => {
				const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
				if (data.byteLength < 12) return
				const flags = data[1] & 0x0f
				const msgType = (data[1] >> 4) & 0x0f
				if (msgType !== 0x09) return
				const payloadSize = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(8)
				if (12 + payloadSize > data.byteLength) return
				const payload = data.subarray(12, 12 + payloadSize)
				let resp
				try { resp = JSON.parse(new TextDecoder().decode(payload)) }
				catch { return }
				const text = resp?.result?.text || ''
				let isFinal = flags === 0x02 || flags === 0x03
				for (const u of resp?.result?.utterances || [])
					if (u.definite) isFinal = true
				if (!text && !isFinal) return
				if (text) lastText = text
				options.onResult?.({ text: lastText, isFinal })
				if (isFinal) finish(lastText)
			})
			ws.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))))
			ws.on('close', () => {
				if (!settled) finish(lastText)
			})

			try {
				const request = {
					model_name: 'bigmodel',
					enable_itn: true,
					enable_punc: true,
					enable_ddc: false,
					enable_word: false,
					enable_nonstream: true,
					result_type: 'full',
					show_utterances: true,
				}
				if (options.hotwords?.length) {
					const hotwords = [...new Set(options.hotwords.map(w => String(w).trim()).filter(Boolean))]
						.map(word => ({ word }))
					if (hotwords.length)
						request.corpus = { context: JSON.stringify({ hotwords }) }
				}
				const initJson = new TextEncoder().encode(JSON.stringify({
					user: { uid: 'fount' },
					audio: { format: 'pcm', rate: 16000, bits: 16, channel: 1, codec: 'raw' },
					request,
				}))
				ws.send(buildFrame(0x10, 0x00, 0x10, initJson))

				await runRecognizeInput(options, {
					/**
					 * @param {Uint8Array} chunk PCM
					 * @param {boolean} isLast 是否末帧
					 * @returns {Promise<void>}
					 */
					onSend: async (chunk, isLast) => {
						ws.send(buildFrame(0x20, isLast ? 0x02 : 0x00, 0x00, chunk))
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
