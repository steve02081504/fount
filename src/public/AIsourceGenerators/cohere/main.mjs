import { escapeRegExp } from '../../../scripts/escape.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

/**
 * @type {import('../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info: {
		'en-UK': {
			name: 'Cohere',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: 'Cohere',
			description_markdown: 'Language models for developers and enterprises.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['cohere', 'ai', 'language-model'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		},
		'zh-CN': {
			name: 'Cohere',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: 'Cohere',
			description_markdown: '为开发者和企业打造的语言模型。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['cohere', 'ai', '语言模型'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		},
		'ar-SA': {
			name: 'Cohere',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: 'Cohere',
			description_markdown: 'نماذج لغوية للمطورين والشركات.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['cohere', 'ai', 'نموذج-لغوي'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		},
		'de-DE': {
			name: 'Cohere',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: 'Cohere',
			description_markdown: 'Sprachmodelle für Entwickler und Unternehmen.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['cohere', 'ki', 'sprachmodell'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		},
		emoji: {
			name: '🗣️',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: 'Cohere',
			description_markdown: 'Language models for developers and enterprises.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['cohere', 'ai', 'language-model'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		},
		'es-ES': {
			name: 'Cohere',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: 'Cohere',
			description_markdown: 'Modelos de lenguaje para desarrolladores y empresas.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['cohere', 'ia', 'modelo-de-lenguaje'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		},
		'fr-FR': {
			name: 'Cohere',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: 'Cohere',
			description_markdown: 'Modèles de langage pour les développeurs et les entreprises.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['cohere', 'ia', 'modèle-de-langage'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		},
		'hi-IN': {
			name: 'Cohere',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: 'कोहेरे',
			description_markdown: 'डेवलपर्स और उद्यमों के लिए भाषा मॉडल।',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['कोहेरे', 'एआई', 'भाषा-मॉडल'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		},
		'is-IS': {
			name: 'Cohere',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: 'Cohere',
			description_markdown: 'Tungumálalíkön fyrir forritara og fyrirtæki.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['cohere', 'gervigreind', 'tungumálalíkan'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		},
		'it-IT': {
			name: 'Cohere',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: 'Cohere',
			description_markdown: 'Modelli linguistici per sviluppatori e aziende.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['cohere', 'ia', 'modello-linguistico'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		},
		'ja-JP': {
			name: 'Cohere',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: 'Cohere',
			description_markdown: '開発者および企業向けの言語モデル。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['cohere', 'ai', '言語モデル'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		},
		'ko-KR': {
			name: 'Cohere',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: '코히어',
			description_markdown: '개발자와 기업을 위한 언어 모델입니다.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['코히어', 'ai', '언어-모델'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		},
		lzh: {
			name: 'Cohere',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: '合智',
			description_markdown: '為開發者與商賈所製之語言模型。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['合智', '智械', '語言模型'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		},
		'nl-NL': {
			name: 'Cohere',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: 'Cohere',
			description_markdown: 'Taalmodellen voor ontwikkelaars en ondernemingen.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['cohere', 'ai', 'taalmodel'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		},
		'pt-PT': {
			name: 'Cohere',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: 'Cohere',
			description_markdown: 'Modelos de linguagem para desenvolvedores e empresas.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['cohere', 'ia', 'modelo-de-linguagem'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		},
		'ru-RU': {
			name: 'Cohere',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: 'Cohere',
			description_markdown: 'Языковые модели для разработчиков и предприятий.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['cohere', 'ии', 'языковая-модель'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		},
		'uk-UA': {
			name: 'Cohere',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: 'Cohere',
			description_markdown: 'Мовні моделі для розробників та підприємств.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['cohere', 'ші', 'мовна-модель'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		},
		'vi-VN': {
			name: 'Cohere',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: 'Cohere',
			description_markdown: 'Các mô hình ngôn ngữ dành cho nhà phát triển và doanh nghiệp.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['cohere', 'ai', 'mô-hình-ngôn-ngữ'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		},
		'zh-TW': {
			name: 'Cohere',
			avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
			description: 'Cohere',
			description_markdown: '為開發者和企業打造的語言模型。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['cohere', 'ai', '語言模型'],
			provider: 'cohere',
			home_page: 'https://cohere.com/'
		}
	},
	interfaces: {
		AIsource: {
			/**
			 * 获取此 AI 源的配置模板。
			 * @returns {Promise<object>} 配置模板。
			 */
			GetConfigTemplate: async () => configTemplate,
			GetSource,
		}
	}
}

const configTemplate = {
	name: 'cohere-command-r-plus',
	model: 'command-r-plus',
	apikey: '',
	convert_config: {
		roleReminding: true
	}
}
/**
 * 获取 AI 源。
 * @param {object} config - 配置对象。
 * @returns {Promise<AIsource_t>} AI 源。
 */
async function GetSource(config) {
	const { CohereClientV2 } = await import('npm:cohere-ai')
	const cohere = new CohereClientV2({
		token: config.apikey,
	})
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'en-UK': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: 'Cohere',
				description_markdown: 'Language models for developers and enterprises.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['cohere', 'ai', 'language-model'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			},
			'zh-CN': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: 'Cohere',
				description_markdown: '为开发者和企业打造的语言模型。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['cohere', 'ai', '语言模型'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			},
			'ar-SA': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: 'Cohere',
				description_markdown: 'نماذج لغوية للمطورين والشركات.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['cohere', 'ai', 'نموذج-لغوي'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			},
			'de-DE': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: 'Cohere',
				description_markdown: 'Sprachmodelle für Entwickler und Unternehmen.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['cohere', 'ki', 'sprachmodell'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			},
			emoji: {
				name: '🗣️',
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: 'Cohere',
				description_markdown: 'Language models for developers and enterprises.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['cohere', 'ai', 'language-model'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			},
			'es-ES': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: 'Cohere',
				description_markdown: 'Modelos de lenguaje para desarrolladores y empresas.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['cohere', 'ia', 'modelo-de-lenguaje'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			},
			'fr-FR': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: 'Cohere',
				description_markdown: 'Modèles de langage pour les développeurs et les entreprises.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['cohere', 'ia', 'modèle-de-langage'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			},
			'hi-IN': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: 'कोहेरे',
				description_markdown: 'डेवलपर्स और उद्यमों के लिए भाषा मॉडल।',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['कोहेरे', 'एआई', 'भाषा-मॉडल'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			},
			'is-IS': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: 'Cohere',
				description_markdown: 'Tungumálalíkön fyrir forritara og fyrirtæki.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['cohere', 'gervigreind', 'tungumálalíkan'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			},
			'it-IT': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: 'Cohere',
				description_markdown: 'Modelli linguistici per sviluppatori e aziende.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['cohere', 'ia', 'modello-linguistico'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			},
			'ja-JP': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: 'Cohere',
				description_markdown: '開発者および企業向けの言語モデル。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['cohere', 'ai', '言語モデル'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			},
			'ko-KR': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: '코히어',
				description_markdown: '개발자와 기업을 위한 언어 모델입니다.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['코히어', 'ai', '언어-모델'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			},
			lzh: {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: '合智',
				description_markdown: '為開發者與商賈所製之語言模型。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['合智', '智械', '語言模型'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			},
			'nl-NL': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: 'Cohere',
				description_markdown: 'Taalmodellen voor ontwikkelaars en ondernemingen.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['cohere', 'ai', 'taalmodel'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			},
			'pt-PT': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: 'Cohere',
				description_markdown: 'Modelos de linguagem para desenvolvedores e empresas.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['cohere', 'ia', 'modelo-de-linguagem'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			},
			'ru-RU': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: 'Cohere',
				description_markdown: 'Языковые модели для разработчиков и предприятий.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['cohere', 'ии', 'языковая-модель'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			},
			'uk-UA': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: 'Cohere',
				description_markdown: 'Мовні моделі для розробників та підприємств.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['cohere', 'ші', 'мовна-модель'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			},
			'vi-VN': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: 'Cohere',
				description_markdown: 'Các mô hình ngôn ngữ dành cho nhà phát triển và doanh nghiệp.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['cohere', 'ai', 'mô-hình-ngôn-ngữ'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			},
			'zh-TW': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/cohere.svg',
				description: 'Cohere',
				description_markdown: '為開發者和企業打造的語言模型。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['cohere', 'ai', '語言模型'],
				provider: 'cohere',
				home_page: 'https://cohere.com/'
			}
		},
		is_paid: false,
		extension: {},

		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		Call: async prompt => {
			const result = await cohere.generate({ prompt, model: config.model })
			return {
				content: result.generations.map(generation => generation.text).join('\n')
			}
		},
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			const system_prompt = structPromptToSingleNoChatLog(prompt_struct)
			const request = {
				model: config.model,
				messages: [{
					role: 'system',
					content: system_prompt
				}]
			}
			margeStructPromptChatLog(prompt_struct).forEach(chatLogEntry => {
				const uid = Math.random().toString(36).slice(2, 10)
				request.messages.push({
					role: chatLogEntry.role === 'user' ? 'user' : chatLogEntry.role === 'system' ? 'system' : 'assistant',
					content: `\
<message "${uid}">
<sender>${chatLogEntry.name}</sender>
<content>
${chatLogEntry.content}
</content>
</message "${uid}">
`
				})
			})

			if (config.convert_config?.roleReminding ?? true) {
				const isMutiChar = new Set(prompt_struct.chat_log.map(chatLogEntry => chatLogEntry.name).filter(Boolean)).size > 2
				if (isMutiChar)
					request.messages.push({
						role: 'system',
						content: `现在请以${prompt_struct.Charname}的身份续写对话。`
					})
			}

			const result = await cohere.chat(request)
			let text = result?.message?.content?.map(message => message?.text)?.filter(text => text)?.join('\n')
			if (!text) throw result

			if (text.match(/<\/sender>\s*<content>/))
				text = text.match(/<\/sender>\s*<content>([\S\s]*)<\/content>/)[1].split(new RegExp(
					`(${(prompt_struct.alternative_charnames || []).map(Object).map(
						stringOrReg => {
							if (stringOrReg instanceof String) return escapeRegExp(stringOrReg)
							return stringOrReg.source
						}
					).join('|')
					})\\s*<\\/sender>\\s*<content>`
				)).pop().split(/<\/content>\s*<\/message/).shift()
			if (text.match(/<\/content>\s*<\/message[^>]*>\s*$/))
				text = text.split(/<\/content>\s*<\/message[^>]*>\s*$/).shift()

			const removeduplicate = [...new Set(text.split('\n'))].join('\n')
			if (removeduplicate.length / text.length < 0.3)
				text = removeduplicate

			return {
				content: text
			}
		},
		tokenizer: {
			/**
			 * 释放分词器。
			 * @returns {number} 0
			 */
			free: () => 0,
			/**
			 * 编码提示。
			 * @param {string} prompt - 要编码的提示。
			 * @returns {Promise<number[]>} 编码后的令牌。
			 */
			encode: prompt => cohere.tokenize({
				model: config.model,
				text: prompt
			}).then(result => result.tokens),
			/**
			 * 解码令牌。
			 * @param {number[]} tokens - 要解码的令牌。
			 * @returns {Promise<string>} 解码后的文本。
			 */
			decode: tokens => cohere.detokenize({
				model: config.model,
				tokens
			}).then(result => result.text),
			/**
			 * 解码单个令牌。
			 * @param {number} token - 要解码的令牌。
			 * @returns {Promise<string>} 解码后的文本。
			 */
			decode_single: token => cohere.detokenize({
				model: config.model,
				tokens: [token]
			}).then(result => result.text),
			/**
			 * 获取令牌计数。
			 * @param {string} prompt - 要计算令牌的提示。
			 * @returns {Promise<number>} 令牌数。
			 */
			get_token_count: prompt => cohere.tokenize({
				model: config.model,
				text: prompt
			}).then(result => result.tokens.length)
		}
	}

	return result
}
