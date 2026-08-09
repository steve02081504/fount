/**
 * @typedef {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionSource_t} SpeechRecognitionSource_t
 */

import { bytesToBase64, normalizeLang, pcmToWav } from '../shared/pcm.mjs'
import { buildSourceInfo, recognizeByBuffering } from '../shared/recognizeHelpers.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 小米 MiMo 批式语音识别生成器。
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
	name: 'xiaomi-mimo',
	api_key: '',
	model: 'mimo-v2.5-asr',
	endpoint: 'https://api.xiaomimimo.com/v1/chat/completions',
}

/**
 * @param {object} config 配置
 * @returns {Promise<SpeechRecognitionSource_t>} 源
 */
async function GetSource(config) {
	const apiKey = config.api_key
	const model = config.model || configTemplate.model
	const endpoint = config.endpoint || configTemplate.endpoint

	return {
		type: 'speech-recognition',
		info: buildSourceInfo(product_info, { name: config.name || 'Xiaomi MiMo Speech Recognition', provider: 'xiaomi' }),
		is_paid: true,
		extension: {},
		/**
		 * @param {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionOptions_t} options 选项
		 * @returns {Promise<import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionResult_t>} 结果
		 */
		Recognize: async (options) => recognizeByBuffering(options, async (pcm) => {
			const wav = pcmToWav(pcm)
			const asr_options = {
				language: normalizeLang(options.language, 'auto'),
			}
			if (options.hotwords?.length) asr_options.hotwords = options.hotwords

			const resp = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'api-key': apiKey,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model,
					messages: [{
						role: 'user',
						content: [{
							type: 'input_audio',
							input_audio: {
								data: `data:audio/wav;base64,${bytesToBase64(wav)}`,
								format: 'wav',
							},
						}],
					}],
					asr_options,
				}),
				signal: options.signal,
			})
			const body = await resp.text()
			if (!resp.ok) throw new Error(`mimo-asr API: HTTP ${resp.status}: ${body}`)
			const json = JSON.parse(body)
			const text = json.choices?.[0]?.message?.content
			if (text == null) throw new Error('mimo-asr: empty response')
			return String(text).trim()
		}),
		interfaces: {}
	}
}
