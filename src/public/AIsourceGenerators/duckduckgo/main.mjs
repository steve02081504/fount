import { escapeRegExp } from '../../../scripts/regex.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'

import { DuckDuckGoAPI } from './duckduckgo.mjs'

/**
 * @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t
 * @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t
 */

/**
 * @type {import('../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info: {
		'en-UK': {
			name: 'DuckDuckGo',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'DuckDuckGo AI Chat',
			description_markdown: 'Privacy-focused AI chat from DuckDuckGo.',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['duckduckgo', 'ai', 'privacy'],
			home_page: 'https://duckduckgo.com/'
		},
		'zh-CN': {
			name: 'DuckDuckGo',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'DuckDuckGo AI 聊天',
			description_markdown: '来自 DuckDuckGo 的注重隐私的 AI 聊天。',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['duckduckgo', 'ai', '隐私'],
			home_page: 'https://duckduckgo.com/'
		},
		'ar-SA': {
			name: 'DuckDuckGo',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'دردشة DuckDuckGo AI',
			description_markdown: 'دردشة ذكاء اصطناعي تركز على الخصوصية من DuckDuckGo.',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['duckduckgo', 'ai', 'خصوصية'],
			home_page: 'https://duckduckgo.com/'
		},
		'de-DE': {
			name: 'DuckDuckGo',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'DuckDuckGo AI-Chat',
			description_markdown: 'Datenschutzorientierter KI-Chat von DuckDuckGo.',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['duckduckgo', 'ki', 'datenschutz'],
			home_page: 'https://duckduckgo.com/'
		},
		emoji: {
			name: '🦆',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'DuckDuckGo AI Chat',
			description_markdown: 'Privacy-focused AI chat from DuckDuckGo.',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['duckduckgo', 'ai', 'privacy'],
			home_page: 'https://duckduckgo.com/'
		},
		'es-ES': {
			name: 'DuckDuckGo',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'Chat de IA de DuckDuckGo',
			description_markdown: 'Chat de IA centrado en la privacidad de DuckDuckGo.',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['duckduckgo', 'ia', 'privacidad'],
			home_page: 'https://duckduckgo.com/'
		},
		'fr-FR': {
			name: 'DuckDuckGo',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'Chat IA de DuckDuckGo',
			description_markdown: 'Chat IA axé sur la confidentialité de DuckDuckGo.',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['duckduckgo', 'ia', 'confidentialité'],
			home_page: 'https://duckduckgo.com/'
		},
		'hi-IN': {
			name: 'DuckDuckGo',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'डकडकगो एआई चैट',
			description_markdown: 'डकडकगो से गोपनीयता-केंद्रित एआई चैट।',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['डकडकगो', 'एआई', 'गोपनीयता'],
			home_page: 'https://duckduckgo.com/'
		},
		'is-IS': {
			name: 'DuckDuckGo',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'DuckDuckGo gervigreindarspjall',
			description_markdown: 'Persónuverndarmiðað gervigreindarspjall frá DuckDuckGo.',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['duckduckgo', 'gervigreind', 'persónuvernd'],
			home_page: 'https://duckduckgo.com/'
		},
		'it-IT': {
			name: 'DuckDuckGo',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'Chat AI di DuckDuckGo',
			description_markdown: 'Chat AI incentrata sulla privacy di DuckDuckGo.',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['duckduckgo', 'ia', 'privacy'],
			home_page: 'https://duckduckgo.com/'
		},
		'ja-JP': {
			name: 'DuckDuckGo',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'DuckDuckGo AI チャット',
			description_markdown: 'DuckDuckGo のプライバシーを重視した AI チャット。',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['duckduckgo', 'ai', 'プライバシー'],
			home_page: 'https://duckduckgo.com/'
		},
		'ko-KR': {
			name: 'DuckDuckGo',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'DuckDuckGo AI 채팅',
			description_markdown: 'DuckDuckGo의 개인 정보 보호 중심 AI 채팅입니다.',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['duckduckgo', 'ai', '개인 정보 보호'],
			home_page: 'https://duckduckgo.com/'
		},
		lzh: {
			name: 'DuckDuckGo',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'DuckDuckGo 智械談',
			description_markdown: 'DuckDuckGo 之重隱私智械談。',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['duckduckgo', '智械', '隱私'],
			home_page: 'https://duckduckgo.com/'
		},
		'nl-NL': {
			name: 'DuckDuckGo',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'DuckDuckGo AI-chat',
			description_markdown: 'Privacygerichte AI-chat van DuckDuckGo.',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['duckduckgo', 'ai', 'privacy'],
			home_page: 'https://duckduckgo.com/'
		},
		'pt-PT': {
			name: 'DuckDuckGo',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'Chat de IA do DuckDuckGo',
			description_markdown: 'Chat de IA focado na privacidade do DuckDuckGo.',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['duckduckgo', 'ia', 'privacidade'],
			home_page: 'https://duckduckgo.com/'
		},
		'ru-RU': {
			name: 'DuckDuckGo',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'DuckDuckGo AI-чат',
			description_markdown: 'Конфиденциальный AI-чат от DuckDuckGo.',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['duckduckgo', 'ии', 'конфиденциальность'],
			home_page: 'https://duckduckgo.com/'
		},
		'uk-UA': {
			name: 'DuckDuckGo',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'DuckDuckGo AI-чат',
			description_markdown: 'Конфіденційний AI-чат від DuckDuckGo.',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['duckduckgo', 'ші', 'конфіденційність'],
			home_page: 'https://duckduckgo.com/'
		},
		'vi-VN': {
			name: 'DuckDuckGo',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'Trò chuyện AI của DuckDuckGo',
			description_markdown: 'Trò chuyện AI tập trung vào quyền riêng tư của DuckDuckGo.',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['duckduckgo', 'ai', 'quyền riêng tư'],
			home_page: 'https://duckduckgo.com/'
		},
		'zh-TW': {
			name: 'DuckDuckGo',
			avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
			description: 'DuckDuckGo AI 聊天',
			description_markdown: '來自 DuckDuckGo 的注重隱私的 AI 聊天。',
			version: '0.1.0',
			author: 'steve02081504',
			tags: ['duckduckgo', 'ai', '隱私'],
			home_page: 'https://duckduckgo.com/'
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
	name: 'DuckDuckGo',
	model: 'gpt-4o-mini',
	convert_config: {
		roleReminding: true
	}
}
/**
 * 创建一个 DuckDuckGo AI 来源生成器
 * @param {object} config - 配置对象
 * @param {string} [config.name] - AI 来源的名称，默认为模型名称
 * @param {string} [config.model] - 使用的模型，默认为 'gpt-4o-mini'
 * @param {object} [config.fake_headers] - 自定义的请求头
 * @returns {Promise<AIsource_t>} AI 来源对象
 */
async function GetSource(config) {
	const duckduckgo = new DuckDuckGoAPI(config)

	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'en-UK': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'DuckDuckGo AI Chat',
				description_markdown: 'Privacy-focused AI chat from DuckDuckGo.',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['duckduckgo', 'ai', 'privacy'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			},
			'zh-CN': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'DuckDuckGo AI 聊天',
				description_markdown: '来自 DuckDuckGo 的注重隐私的 AI 聊天。',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['duckduckgo', 'ai', '隐私'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			},
			'ar-SA': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'دردشة DuckDuckGo AI',
				description_markdown: 'دردشة ذكاء اصطناعي تركز على الخصوصية من DuckDuckGo.',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['duckduckgo', 'ai', 'خصوصية'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			},
			'de-DE': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'DuckDuckGo AI-Chat',
				description_markdown: 'Datenschutzorientierter KI-Chat von DuckDuckGo.',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['duckduckgo', 'ki', 'datenschutz'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			},
			emoji: {
				name: '🦆',
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'DuckDuckGo AI Chat',
				description_markdown: 'Privacy-focused AI chat from DuckDuckGo.',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['duckduckgo', 'ai', 'privacy'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			},
			'es-ES': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'Chat de IA de DuckDuckGo',
				description_markdown: 'Chat de IA centrado en la privacidad de DuckDuckGo.',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['duckduckgo', 'ia', 'privacidad'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			},
			'fr-FR': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'Chat IA de DuckDuckGo',
				description_markdown: 'Chat IA axé sur la confidentialité de DuckDuckGo.',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['duckduckgo', 'ia', 'confidentialité'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			},
			'hi-IN': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'डकडकगो एआई चैट',
				description_markdown: 'डकडकगो से गोपनीयता-केंद्रित एआई चैट।',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['डकडकगो', 'एआई', 'गोपनीयता'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			},
			'is-IS': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'DuckDuckGo gervigreindarspjall',
				description_markdown: 'Persónuverndarmiðað gervigreindarspjall frá DuckDuckGo.',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['duckduckgo', 'gervigreind', 'persónuvernd'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			},
			'it-IT': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'Chat AI di DuckDuckGo',
				description_markdown: 'Chat AI incentrata sulla privacy di DuckDuckGo.',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['duckduckgo', 'ia', 'privacy'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			},
			'ja-JP': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'DuckDuckGo AI チャット',
				description_markdown: 'DuckDuckGo のプライバシーを重視した AI チャット。',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['duckduckgo', 'ai', 'プライバシー'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			},
			'ko-KR': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'DuckDuckGo AI 채팅',
				description_markdown: 'DuckDuckGo의 개인 정보 보호 중심 AI 채팅입니다.',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['duckduckgo', 'ai', '개인 정보 보호'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			},
			lzh: {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'DuckDuckGo 智械談',
				description_markdown: 'DuckDuckGo 之重隱私智械談。',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['duckduckgo', '智械', '隱私'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			},
			'nl-NL': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'DuckDuckGo AI-chat',
				description_markdown: 'Privacygerichte AI-chat van DuckDuckGo.',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['duckduckgo', 'ai', 'privacy'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			},
			'pt-PT': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'Chat de IA do DuckDuckGo',
				description_markdown: 'Chat de IA focado na privacidade do DuckDuckGo.',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['duckduckgo', 'ia', 'privacidade'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			},
			'ru-RU': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'DuckDuckGo AI-чат',
				description_markdown: 'Конфиденциальный AI-чат от DuckDuckGo.',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['duckduckgo', 'ии', 'конфиденциальность'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			},
			'uk-UA': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'DuckDuckGo AI-чат',
				description_markdown: 'Конфіденційний AI-чат від DuckDuckGo.',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['duckduckgo', 'ші', 'конфіденційність'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			},
			'vi-VN': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'Trò chuyện AI của DuckDuckGo',
				description_markdown: 'Trò chuyện AI tập trung vào quyền riêng tư của DuckDuckGo.',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['duckduckgo', 'ai', 'quyền riêng tư'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			},
			'zh-TW': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/duckduckgo.svg',
				description: 'DuckDuckGo AI 聊天',
				description_markdown: '來自 DuckDuckGo 的注重隱私的 AI 聊天。',
				version: '0.1.0',
				author: 'steve02081504',
				tags: ['duckduckgo', 'ai', '隱私'],
				provider: 'duckduckgo',
				home_page: 'https://duckduckgo.com/'
			}
		},
		is_paid: false,
		extension: {},

		/**
		 * 卸载 AI 源。
		 */
		Unload: () => {
			// 在这里执行清理操作，如果有必要的话
		},

		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		Call: async prompt => {
			const messages = [{ role: 'user', content: prompt }] // 将字符串 prompt 包装成一个消息对象
			const model = config.model || 'gpt-4o-mini'
			const returnStream = config?.stream || false
			const result = await duckduckgo.call(messages, model, returnStream)
			return {
				content: result,
			}
		},

		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			const messages = []
			margeStructPromptChatLog(prompt_struct).forEach(chatLogEntry => {
				const uid = Math.random().toString(36).slice(2, 10)
				messages.push({
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

			const system_prompt = structPromptToSingleNoChatLog(prompt_struct)
			if (config.system_prompt_at_depth ?? 10)
				messages.splice(Math.max(messages.length - (config.system_prompt_at_depth ?? 10), 0), 0, {
					role: 'system',
					content: system_prompt
				})
			else
				messages.unshift({
					role: 'system',
					content: system_prompt
				})

			if (config.convert_config?.roleReminding ?? true) {
				const isMutiChar = new Set(prompt_struct.chat_log.map(chatLogEntry => chatLogEntry.name).filter(Boolean)).size > 2
				if (isMutiChar)
					messages.push({
						role: 'system',
						content: `现在请以${prompt_struct.Charname}的身份续写对话。`
					})
			}

			const model = config.model || 'gpt-4o-mini'
			let text = await duckduckgo.call(messages, model)

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

			return {
				content: text,
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
			 * @returns {string} 编码后的提示。
			 */
			encode: prompt => prompt,
			/**
			 * 解码令牌。
			 * @param {string} tokens - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode: tokens => tokens,
			/**
			 * 解码单个令牌。
			 * @param {string} token - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode_single: token => token,
			/**
			 * 获取令牌计数。
			 * @param {string} prompt - 要计算令牌的提示。
			 * @returns {Promise<number>} 令牌数。
			 */
			get_token_count: prompt => duckduckgo.countTokens(prompt)
		}
	}

	return result
}
