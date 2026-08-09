/**
 * @typedef {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionSource_t} SpeechRecognitionSource_t
 */

import { bytesToBase64, normalizeLang, upsamplePcm16kTo24k } from '../shared/pcm.mjs'
import { buildSourceInfo, runRecognizeInput } from '../shared/recognizeHelpers.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * OpenAI Realtime 流式语音识别生成器。
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
	name: 'openai-realtime',
	api_key: '',
	model: 'gpt-4o-mini-transcribe',
	realtime_model: 'gpt-4o-realtime-preview',
	base_url: 'wss://api.openai.com/v1/realtime',
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
	const apiKey = config.api_key
	const model = config.model || configTemplate.model
	const realtimeModel = config.realtime_model || configTemplate.realtime_model
	const baseUrl = config.base_url || configTemplate.base_url

	return {
		type: 'speech-recognition',
		info: buildSourceInfo(product_info, { name: config.name || 'OpenAI Realtime Speech Recognition', provider: 'openai' }),
		is_paid: true,
		extension: {},
		/**
		 * @param {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionOptions_t} options 选项
		 * @returns {Promise<import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionResult_t>} 结果
		 */
		Recognize: async (options) => {
			const wsUrl = `${baseUrl}?${new URLSearchParams({ model: realtimeModel })}`
			const ws = await openHeaderWs(wsUrl, {
				Authorization: `Bearer ${apiKey}`,
				'OpenAI-Beta': 'realtime=v1',
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
			 * @param {Error} error 错误
			 * @returns {void}
			 */
			const fail = (error) => {
				if (settled) return
				settled = true
				rejectFinal(error)
			}

			/**
			 * @param {AbortSignal} [signal] 中止
			 * @returns {void}
			 */
			const onAbort = () => {
				fail(options.signal?.reason instanceof Error ? options.signal.reason : new Error('aborted'))
				ws.close()
			}
			options.signal?.addEventListener('abort', onAbort, { once: true })

			ws.on('message', (raw) => {
				const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
				let message
				try { message = JSON.parse(text) }
				catch { return }
				if (message.type === 'conversation.item.input_audio_transcription.delta') {
					if (message.delta) {
						lastText += message.delta
						options.onResult?.({ text: lastText, isFinal: false })
					}
				}
				else if (message.type === 'conversation.item.input_audio_transcription.completed') {
					lastText = message.transcript || lastText
					options.onResult?.({ text: lastText, isFinal: true })
					finish(lastText)
				}
				else if (message.type === 'error')
					fail(new Error(`openai realtime: ${message.error?.message || text}`))
			})
			ws.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))))
			ws.on('close', () => {
				if (!settled) fail(new Error('openai realtime: connection closed before final transcript'))
			})

			try {
				const lang = normalizeLang(options.language, 'short')
				const transcription = { model, language: lang }
				if (options.hotwords?.length)
					transcription.prompt = options.hotwords.join(', ')
				ws.send(JSON.stringify({
					type: 'session.update',
					session: {
						input_audio_format: 'pcm16',
						input_audio_transcription: transcription,
						turn_detection: null,
					},
				}))

				await runRecognizeInput(options, {
					/**
					 * @param {Uint8Array} chunk PCM
					 * @param {boolean} isLast 是否末帧
					 * @returns {Promise<void>}
					 */
					onSend: async (chunk, isLast) => {
						if (chunk.byteLength) {
							const audio = bytesToBase64(upsamplePcm16kTo24k(chunk))
							ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio }))
						}
						if (isLast)
							ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
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
