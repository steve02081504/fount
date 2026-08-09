/**
 * @typedef {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionSource_t} SpeechRecognitionSource_t
 */

import { buildSourceInfo, runRecognizeInput } from '../shared/recognizeHelpers.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * Mock 语音识别生成器：假流式吐出配置文字。
 * @type {import('../../../../../decl/SpeechRecognitionSourceGenerator.ts').SpeechRecognitionSourceGenerator_t}
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * @returns {Promise<object>} 显示
			 */
			GetConfigDisplayContent: async () => ({}),
			/**
			 * @returns {Promise<object>} 模板
			 */
			GetConfigTemplate: async () => configTemplate,
			GetSource,
		}
	}
}

const configTemplate = {
	name: 'mock-speech-recognition',
	text: '这是一段用于测试的假流式识别文字。',
	chunk_delay_ms: 20,
	chunk_size: 1,
}

/**
 * @param {number} ms 毫秒
 * @param {AbortSignal} [signal] 中止
 * @returns {Promise<void>}
 */
function sleep(ms, signal) {
	if (!ms) return Promise.resolve()
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
	const fullText = String(config?.text ?? configTemplate.text)
	const delay = Math.max(0, Number(config?.chunk_delay_ms ?? configTemplate.chunk_delay_ms) || 0)
	const chunkSize = Math.max(1, Number(config?.chunk_size ?? configTemplate.chunk_size) || 1)

	return {
		type: 'speech-recognition',
		info: buildSourceInfo(product_info, { name: config?.name || 'Mock Speech Recognition', provider: 'fount' }),
		is_paid: false,
		extension: {},
		/**
		 * @param {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionOptions_t} options 选项
		 * @returns {Promise<import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionResult_t>} 结果
		 */
		Recognize: async (options) => {
			await runRecognizeInput(options, {
				/**
				 * @returns {Promise<void>}
				 */
				onSend: async () => { },
			})
			const codePoints = Array.from(fullText)
			for (let index = 0; index < codePoints.length; index += chunkSize) {
				if (options.signal?.aborted)
					throw options.signal.reason instanceof Error ? options.signal.reason : new Error('aborted')
				const emitted = codePoints.slice(0, index + chunkSize).join('')
				const isFinal = emitted.length >= fullText.length
				options.onResult?.({ text: emitted, isFinal })
				if (!isFinal) await sleep(delay, options.signal)
			}
			return { text: fullText, language: options.language }
		},
		interfaces: {}
	}
}
