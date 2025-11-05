// main.mjs
import { escapeRegExp } from '../../../scripts/escape.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'

import { GrokAPI } from './grokAPI.mjs'

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
			name: 'Grok',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'Grok by xAI',
			description_markdown: 'An AI chatbot developed by xAI, with a rebellious streak.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['grok', 'xai', 'ai', 'chatbot'],
			home_page: 'https://grok.x.ai/'
		},
		'zh-CN': {
			name: 'Grok',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'Grok by xAI',
			description_markdown: '由 xAI 开发的人工智能聊天机器人，带有一点叛逆精神。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['grok', 'xai', 'ai', '聊天机器人'],
			home_page: 'https://grok.x.ai/'
		},
		'ar-SA': {
			name: 'Grok',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'جروك بواسطة xAI',
			description_markdown: 'روبوت محادثة يعمل بالذكاء الاصطناعي تم تطويره بواسطة xAI، مع لمسة من التمرد.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['جروك', 'xai', 'ذكاء اصطناعي', 'روبوت محادثة'],
			home_page: 'https://grok.x.ai/'
		},
		'de-DE': {
			name: 'Grok',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'Grok von xAI',
			description_markdown: 'Ein von xAI entwickelter KI-Chatbot mit einer rebellischen Ader.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['grok', 'xai', 'ki', 'chatbot'],
			home_page: 'https://grok.x.ai/'
		},
		emoji: {
			name: '🤪',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'Grok by xAI',
			description_markdown: 'An AI chatbot developed by xAI, with a rebellious streak.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['grok', 'xai', 'ai', 'chatbot'],
			home_page: 'https://grok.x.ai/'
		},
		'es-ES': {
			name: 'Grok',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'Grok de xAI',
			description_markdown: 'Un chatbot de IA desarrollado por xAI, con un toque rebelde.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['grok', 'xai', 'ia', 'chatbot'],
			home_page: 'https://grok.x.ai/'
		},
		'fr-FR': {
			name: 'Grok',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'Grok par xAI',
			description_markdown: 'Un chatbot IA développé par xAI, avec un esprit rebelle.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['grok', 'xai', 'ia', 'chatbot'],
			home_page: 'https://grok.x.ai/'
		},
		'hi-IN': {
			name: 'Grok',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'ग्रोक بذریعہ xAI',
			description_markdown: 'xAI द्वारा विकसित एक एआई चैटबॉट, जिसमें विद्रोही भावना है।',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ग्रोक', 'xai', 'एआई', 'चैटबॉट'],
			home_page: 'https://grok.x.ai/'
		},
		'is-IS': {
			name: 'Grok',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'Grok frá xAI',
			description_markdown: 'Gervigreindarspjallbátur þróaður af xAI, með uppreisnargjarnan blæ.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['grok', 'xai', 'gervigreind', 'spjallbátur'],
			home_page: 'https://grok.x.ai/'
		},
		'it-IT': {
			name: 'Grok',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'Grok di xAI',
			description_markdown: 'Un chatbot di intelligenza artificiale sviluppato da xAI, con un tocco ribelle.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['grok', 'xai', 'ia', 'chatbot'],
			home_page: 'https://grok.x.ai/'
		},
		'ja-JP': {
			name: 'Grok',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'xAI の Grok',
			description_markdown: 'xAI によって開発された、反抗的な一面を持つ AI チャットボット。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['grok', 'xai', 'ai', 'チャットボット'],
			home_page: 'https://grok.x.ai/'
		},
		'ko-KR': {
			name: 'Grok',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'xAI의 Grok',
			description_markdown: 'xAI에서 개발한 반항적인 성향의 AI 챗봇입니다.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['grok', 'xai', 'ai', '챗봇'],
			home_page: 'https://grok.x.ai/'
		},
		lzh: {
			name: 'Grok',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'xAI之洞察',
			description_markdown: 'xAI所製之智械談者，具叛逆之性。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['洞察', 'xai', '智械', '談者'],
			home_page: 'https://grok.x.ai/'
		},
		'nl-NL': {
			name: 'Grok',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'Grok van xAI',
			description_markdown: 'Een AI-chatbot ontwikkeld door xAI, met een rebels trekje.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['grok', 'xai', 'ai', 'chatbot'],
			home_page: 'https://grok.x.ai/'
		},
		'pt-PT': {
			name: 'Grok',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'Grok da xAI',
			description_markdown: 'Um chatbot de IA desenvolvido pela xAI, com um toque rebelde.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['grok', 'xai', 'ia', 'chatbot'],
			home_page: 'https://grok.x.ai/'
		},
		'ru-RU': {
			name: 'Grok',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'Grok от xAI',
			description_markdown: 'Чат-бот с искусственным интеллектом, разработанный xAI, с бунтарским характером.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['grok', 'xai', 'ии', 'чат-бот'],
			home_page: 'https://grok.x.ai/'
		},
		'uk-UA': {
			name: 'Grok',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'Grok від xAI',
			description_markdown: 'Чат-бот зі штучним інтелектом, розроблений xAI, з бунтарським характером.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['grok', 'xai', 'ші', 'чат-бот'],
			home_page: 'https://grok.x.ai/'
		},
		'vi-VN': {
			name: 'Grok',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'Grok của xAI',
			description_markdown: 'Một chatbot AI do xAI phát triển, có tính cách nổi loạn.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['grok', 'xai', 'ai', 'chatbot'],
			home_page: 'https://grok.x.ai/'
		},
		'zh-TW': {
			name: 'Grok',
			avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
			description: 'Grok by xAI',
			description_markdown: '由 xAI 開發的人工智慧聊天機器人，帶有一點叛逆精神。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['grok', 'xai', 'ai', '聊天機器人'],
			home_page: 'https://grok.x.ai/'
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
	name: 'Grok',
	model: 'grok-3',
	cookies: [],
	convert_config: {
		roleReminding: true
	}
}

/**
 * 创建一个 Grok AI 来源生成器
 * @param {object} config - 配置对象
 * @param {string} [config.name] - AI 来源的名称，默认为模型名称
 * @param {string} [config.model] - 使用的模型，默认为 'grok-3'
 * @param {string[]} [config.cookies] - Grok Cookies 数组
 * @returns {Promise<AIsource_t>} AI 来源对象
 */
async function GetSource(config) {
	const grok = new GrokAPI(config)

	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'en-UK': {
				name: config.name || config.model,
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'Grok by xAI',
				description_markdown: 'An AI chatbot developed by xAI, with a rebellious streak.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['grok', 'xai', 'ai', 'chatbot'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			},
			'zh-CN': {
				name: config.name || config.model,
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'Grok by xAI',
				description_markdown: '由 xAI 开发的人工智能聊天机器人，带有一点叛逆精神。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['grok', 'xai', 'ai', '聊天机器人'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			},
			'ar-SA': {
				name: config.name || config.model,
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'جروك بواسطة xAI',
				description_markdown: 'روبوت محادثة يعمل بالذكاء الاصطناعي تم تطويره بواسطة xAI، مع لمسة من التمرد.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['جروك', 'xai', 'ذكاء اصطناعي', 'روبوت محادثة'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			},
			'de-DE': {
				name: config.name || config.model,
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'Grok von xAI',
				description_markdown: 'Ein von xAI entwickelter KI-Chatbot mit einer rebellischen Ader.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['grok', 'xai', 'ki', 'chatbot'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			},
			emoji: {
				name: '🤪',
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'Grok by xAI',
				description_markdown: 'An AI chatbot developed by xAI, with a rebellious streak.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['grok', 'xai', 'ai', 'chatbot'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			},
			'es-ES': {
				name: config.name || config.model,
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'Grok de xAI',
				description_markdown: 'Un chatbot de IA desarrollado por xAI, con un toque rebelde.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['grok', 'xai', 'ia', 'chatbot'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			},
			'fr-FR': {
				name: config.name || config.model,
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'Grok par xAI',
				description_markdown: 'Un chatbot IA développé par xAI, avec un esprit rebelle.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['grok', 'xai', 'ia', 'chatbot'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			},
			'hi-IN': {
				name: config.name || config.model,
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'ग्रोक بذریعہ xAI',
				description_markdown: 'xAI द्वारा विकसित एक एआई चैटबॉट, जिसमें विद्रोही भावना है।',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ग्रोक', 'xai', 'एआई', 'चैटबॉट'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			},
			'is-IS': {
				name: config.name || config.model,
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'Grok frá xAI',
				description_markdown: 'Gervigreindarspjallbátur þróaður af xAI, með uppreisnargjarnan blæ.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['grok', 'xai', 'gervigreind', 'spjallbátur'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			},
			'it-IT': {
				name: config.name || config.model,
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'Grok di xAI',
				description_markdown: 'Un chatbot di intelligenza artificiale sviluppato da xAI, con un tocco ribelle.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['grok', 'xai', 'ia', 'chatbot'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			},
			'ja-JP': {
				name: config.name || config.model,
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'xAI の Grok',
				description_markdown: 'xAI によって開発された、反抗的な一面を持つ AI チャットボット。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['grok', 'xai', 'ai', 'チャットボット'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			},
			'ko-KR': {
				name: config.name || config.model,
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'xAI의 Grok',
				description_markdown: 'xAI에서 개발한 반항적인 성향의 AI 챗봇입니다.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['grok', 'xai', 'ai', '챗봇'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			},
			lzh: {
				name: config.name || config.model,
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'xAI之洞察',
				description_markdown: 'xAI所製之智械談者，具叛逆之性。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['洞察', 'xai', '智械', '談者'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			},
			'nl-NL': {
				name: config.name || config.model,
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'Grok van xAI',
				description_markdown: 'Een AI-chatbot ontwikkeld door xAI, met een rebels trekje.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['grok', 'xai', 'ai', 'chatbot'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			},
			'pt-PT': {
				name: config.name || config.model,
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'Grok da xAI',
				description_markdown: 'Um chatbot de IA desenvolvido pela xAI, com um toque rebelde.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['grok', 'xai', 'ia', 'chatbot'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			},
			'ru-RU': {
				name: config.name || config.model,
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'Grok от xAI',
				description_markdown: 'Чат-бот с искусственным интеллектом, разработанный xAI, с бунтарским характером.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['grok', 'xai', 'ии', 'чат-бот'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			},
			'uk-UA': {
				name: config.name || config.model,
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'Grok від xAI',
				description_markdown: 'Чат-бот зі штучним інтелектом, розроблений xAI, з бунтарським характером.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['grok', 'xai', 'ші', 'чат-бот'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			},
			'vi-VN': {
				name: config.name || config.model,
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'Grok của xAI',
				description_markdown: 'Một chatbot AI do xAI phát triển, có tính cách nổi loạn.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['grok', 'xai', 'ai', 'chatbot'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			},
			'zh-TW': {
				name: config.name || config.model,
				avatar: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/grok.svg',
				description: 'Grok by xAI',
				description_markdown: '由 xAI 開發的人工智慧聊天機器人，帶有一點叛逆精神。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['grok', 'xai', 'ai', '聊天機器人'],
				provider: 'xai',
				home_page: 'https://grok.x.ai/'
			}
		},
		is_paid: false, // 根据实际情况设置
		extension: {},

		/**
		 * 卸载 AI 源。
		 */
		Unload: () => {
			// 清理操作（如果有的话）
		},

		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		Call: async prompt => {
			const messages = [{ role: 'user', content: prompt }]
			const model = config.model || 'grok-3'
			const returnStream = config?.stream || false
			const result = await grok.call(messages, model, returnStream)
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

			const model = config.model || 'grok-3'
			let text = await grok.call(messages, model)

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
			free: () => 0, // 或者根据实际情况计算
			/**
			 * 编码提示。
			 * @param {string} prompt - 要编码的提示。
			 * @returns {string} 编码后的提示。
			 */
			encode: prompt => prompt, // Grok 不需要特殊的编码
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
			get_token_count: prompt => grok.countTokens(prompt),
		},
		/**
		 * 生成图像。
		 * @param {string} prompt - 提示。
		 * @param {number} n - 生成图像的数量。
		 * @returns {Promise<{data: any}>} 图像数据。
		 */
		generateImage: async (prompt, n) => {
			const images = await grok.generateImage(prompt, n)
			return {
				data: images
			}
		}
	}

	return result
}
