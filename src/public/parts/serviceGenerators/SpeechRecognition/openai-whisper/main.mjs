/**
 * @typedef {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionSource_t} SpeechRecognitionSource_t
 */

import { normalizeLang, pcmToWav } from '../shared/pcm.mjs'
import { buildSourceInfo, recognizeByBuffering } from '../shared/recognizeHelpers.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * OpenAI Whisper 批式语音识别生成器。
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
	name: 'openai-whisper',
	api_key: '',
	model: 'whisper-1',
	endpoint: '',
	base_url: '',
}

/**
 * @param {object} config 配置
 * @returns {Promise<SpeechRecognitionSource_t>} 源
 */
async function GetSource(config) {
	const apiKey = config.api_key
	const model = config.model || configTemplate.model
	const endpoint = config.endpoint || config.base_url || 'https://api.openai.com/v1/audio/transcriptions'

	return {
		type: 'speech-recognition',
		info: buildSourceInfo(product_info, { name: config.name || 'OpenAI Whisper', provider: 'openai' }),
		is_paid: true,
		extension: {},
		/**
		 * @param {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionOptions_t} options 选项
		 * @returns {Promise<import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionResult_t>} 结果
		 */
		Recognize: async (options) => recognizeByBuffering(options, async (pcm) => {
			const wav = pcmToWav(pcm)
			const form = new FormData()
			form.append('model', model)
			const rawLang = String(options.language || '').trim().toLowerCase()
			if (rawLang && rawLang !== 'auto') {
				const language = normalizeLang(options.language, 'short')
				if (/^[a-z]{2}$/.test(language)) form.append('language', language)
			}
			if (options.hotwords?.length)
				form.append('prompt', options.hotwords.join(', '))
			form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav')

			const resp = await fetch(endpoint, {
				method: 'POST',
				headers: { Authorization: `Bearer ${apiKey}` },
				body: form,
				signal: options.signal,
			})
			const body = await resp.text()
			if (!resp.ok) throw new Error(`whisper API: HTTP ${resp.status}: ${body}`)
			const json = JSON.parse(body)
			return String(json.text || '')
		}),
		interfaces: {}
	}
}
