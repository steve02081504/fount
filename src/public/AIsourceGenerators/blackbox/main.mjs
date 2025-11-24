import { with_timeout } from '../../../scripts/await_timeout.mjs'
import { escapeRegExp } from '../../../scripts/escape.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'

import { BlackboxAI } from './blackbox.mjs'
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

/**
 * @type {import('../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info: {
		'en-UK': {
			name: 'Blackbox',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: 'Blackbox AI',
			description_markdown: 'An AI that can answer questions and write code.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['blackbox', 'ai', 'code'],
			home_page: 'https://www.blackbox.ai/'
		},
		'zh-CN': {
			name: 'Blackbox',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: 'Blackbox AI',
			description_markdown: '一个可以回答问题和编写代码的人工智能。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['blackbox', 'ai', '代码'],
			home_page: 'https://www.blackbox.ai/'
		},
		'ar-SA': {
			name: 'Blackbox',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: 'Blackbox AI',
			description_markdown: 'ذكاء اصطناعي يمكنه الإجابة على الأسئلة وكتابة التعليمات البرمجية.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['blackbox', 'ai', 'كود'],
			home_page: 'https://www.blackbox.ai/'
		},
		'de-DE': {
			name: 'Blackbox',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: 'Blackbox AI',
			description_markdown: 'Eine KI, die Fragen beantworten und Code schreiben kann.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['blackbox', 'ki', 'code'],
			home_page: 'https://www.blackbox.ai/'
		},
		emoji: {
			name: '⬛️📦',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: '⬛️🧠💻',
			description_markdown: '❓➕💻➡️⬛️📦➡️✨',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['⬛️', '📦', '🧠'],
			home_page: 'https://www.blackbox.ai/'
		},
		'es-ES': {
			name: 'Blackbox',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: 'Blackbox AI',
			description_markdown: 'Una IA que puede responder preguntas y escribir código.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['blackbox', 'ia', 'código'],
			home_page: 'https://www.blackbox.ai/'
		},
		'fr-FR': {
			name: 'Blackbox',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: 'Blackbox AI',
			description_markdown: 'Une IA capable de répondre à des questions et d\'écrire du code.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['blackbox', 'ia', 'code'],
			home_page: 'https://www.blackbox.ai/'
		},
		'hi-IN': {
			name: 'Blackbox',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: 'ब्लैकबॉक्स एआई',
			description_markdown: 'एक एआई जो सवालों के जवाब दे सकता है और कोड लिख सकता है।',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['ब्लैकबॉक्स', 'एआई', 'कोड'],
			home_page: 'https://www.blackbox.ai/'
		},
		'is-IS': {
			name: 'Blackbox',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: 'Blackbox gervigreind',
			description_markdown: 'Gervigreind sem getur svarað spurningum og skrifað kóða.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['blackbox', 'gervigreind', 'kóði'],
			home_page: 'https://www.blackbox.ai/'
		},
		'it-IT': {
			name: 'Blackbox',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: 'Blackbox AI',
			description_markdown: 'Un\'intelligenza artificiale in grado di rispondere a domande e scrivere codice.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['blackbox', 'ia', 'codice'],
			home_page: 'https://www.blackbox.ai/'
		},
		'ja-JP': {
			name: 'Blackbox',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: 'Blackbox AI',
			description_markdown: '質問に答えたり、コードを書いたりできる AI。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['blackbox', 'ai', 'コード'],
			home_page: 'https://www.blackbox.ai/'
		},
		'ko-KR': {
			name: 'Blackbox',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: '블랙박스 AI',
			description_markdown: '질문에 답하고 코드를 작성할 수 있는 AI입니다.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['블랙박스', 'ai', '코드'],
			home_page: 'https://www.blackbox.ai/'
		},
		lzh: {
			name: 'Blackbox',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: '黑箱智械',
			description_markdown: '能應問、作碼之智械。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['黑箱', '智械', '碼'],
			home_page: 'https://www.blackbox.ai/'
		},
		'nl-NL': {
			name: 'Blackbox',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: 'Blackbox AI',
			description_markdown: 'Een AI die vragen kan beantwoorden en code kan schrijven.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['blackbox', 'ai', 'code'],
			home_page: 'https://www.blackbox.ai/'
		},
		'pt-PT': {
			name: 'Blackbox',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: 'IA Blackbox',
			description_markdown: 'Uma IA que pode responder a perguntas e escrever código.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['blackbox', 'ia', 'código'],
			home_page: 'https://www.blackbox.ai/'
		},
		'ru-RU': {
			name: 'Blackbox',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: 'ИИ Blackbox',
			description_markdown: 'ИИ, который может отвечать на вопросы и писать код.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['blackbox', 'ии', 'код'],
			home_page: 'https://www.blackbox.ai/'
		},
		'uk-UA': {
			name: 'Blackbox',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: 'ШІ Blackbox',
			description_markdown: 'ШІ, який може відповідати на запитання та писати код.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['blackbox', 'ші', 'код'],
			home_page: 'https://www.blackbox.ai/'
		},
		'vi-VN': {
			name: 'Blackbox',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: 'AI hộp đen',
			description_markdown: 'Một AI có thể trả lời câu hỏi và viết mã.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['hộp đen', 'ai', 'mã'],
			home_page: 'https://www.blackbox.ai/'
		},
		'zh-TW': {
			name: 'Blackbox',
			avatar: 'https://www.blackbox.ai/favicon.svg',
			description: '黑盒子 AI',
			description_markdown: '一個可以回答問題和編寫程式碼的人工智慧。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['黑盒子', 'ai', '程式碼'],
			home_page: 'https://www.blackbox.ai/'
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
	name: 'Blackbox',
	model: 'claude-3-5-sonnet',
	timeout: 10000,
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
	const blackbox = new BlackboxAI(config)
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'en-UK': {
				name: config.name || config.model,
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: 'Blackbox AI',
				description_markdown: 'An AI that can answer questions and write code.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['blackbox', 'ai', 'code'],
				provider: 'blackbox',
				home_page: 'https://www.blackbox.ai/'
			},
			'zh-CN': {
				name: config.name || config.model,
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: 'Blackbox AI',
				description_markdown: '一个可以回答问题和编写代码的人工智能。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['blackbox', 'ai', '代码'],
				provider: 'blackbox',
				home_page: 'https://www.blackbox.ai/'
			},
			'ar-SA': {
				name: config.name || config.model,
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: 'Blackbox AI',
				description_markdown: 'ذكاء اصطناعي يمكنه الإجابة على الأسئلة وكتابة التعليمات البرمجية.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['blackbox', 'ai', 'كود'],
				provider: 'blackbox',
				home_page: 'https://www.blackbox.ai/'
			},
			'de-DE': {
				name: config.name || config.model,
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: 'Blackbox AI',
				description_markdown: 'Eine KI, die Fragen beantworten und Code schreiben kann.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['blackbox', 'ki', 'code'],
				provider: 'blackbox',
				home_page: 'https://www.blackbox.ai/'
			},
			emoji: {
				name: '⬛️📦',
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: '⬛️🧠💻',
				description_markdown: '❓➕💻➡️⬛️📦➡️✨',
				version: '0.0.0',
				author: 'steve02081504',
				provider: 'blackbox',
				tags: ['⬛️', '📦', '🧠'],
				home_page: 'https://www.blackbox.ai/'
			},
			'es-ES': {
				name: config.name || config.model,
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: 'Blackbox AI',
				description_markdown: 'Una IA que puede responder preguntas y escribir código.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['blackbox', 'ia', 'código'],
				provider: 'blackbox',
				home_page: 'https://www.blackbox.ai/'
			},
			'fr-FR': {
				name: config.name || config.model,
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: 'Blackbox AI',
				description_markdown: 'Une IA capable de répondre à des questions et d\'écrire du code.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['blackbox', 'ia', 'code'],
				provider: 'blackbox',
				home_page: 'https://www.blackbox.ai/'
			},
			'hi-IN': {
				name: config.name || config.model,
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: 'ब्लैकबॉक्स एआई',
				description_markdown: 'एक एआई जो सवालों के जवाब दे सकता है और कोड लिख सकता है।',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['ब्लैकबॉक्स', 'एआई', 'कोड'],
				provider: 'blackbox',
				home_page: 'https://www.blackbox.ai/'
			},
			'is-IS': {
				name: config.name || config.model,
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: 'Blackbox gervigreind',
				description_markdown: 'Gervigreind sem getur svarað spurningum og skrifað kóða.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['blackbox', 'gervigreind', 'kóði'],
				provider: 'blackbox',
				home_page: 'https://www.blackbox.ai/'
			},
			'it-IT': {
				name: config.name || config.model,
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: 'Blackbox AI',
				description_markdown: 'Un\'intelligenza artificiale in grado di rispondere a domande e scrivere codice.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['blackbox', 'ia', 'codice'],
				provider: 'blackbox',
				home_page: 'https://www.blackbox.ai/'
			},
			'ja-JP': {
				name: config.name || config.model,
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: 'Blackbox AI',
				description_markdown: '質問に答えたり、コードを書いたりできる AI。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['blackbox', 'ai', 'コード'],
				provider: 'blackbox',
				home_page: 'https://www.blackbox.ai/'
			},
			'ko-KR': {
				name: config.name || config.model,
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: '블랙박스 AI',
				description_markdown: '질문에 답하고 코드를 작성할 수 있는 AI입니다.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['블랙박스', 'ai', '코드'],
				provider: 'blackbox',
				home_page: 'https://www.blackbox.ai/'
			},
			lzh: {
				name: config.name || config.model,
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: '黑箱智械',
				description_markdown: '能應問、作碼之智械。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['黑箱', '智械', '碼'],
				provider: 'blackbox',
				home_page: 'https://www.blackbox.ai/'
			},
			'nl-NL': {
				name: config.name || config.model,
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: 'Blackbox AI',
				description_markdown: 'Een AI die vragen kan beantwoorden en code kan schrijven.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['blackbox', 'ai', 'code'],
				provider: 'blackbox',
				home_page: 'https://www.blackbox.ai/'
			},
			'pt-PT': {
				name: config.name || config.model,
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: 'IA Blackbox',
				description_markdown: 'Uma IA que pode responder a perguntas e escrever código.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['blackbox', 'ia', 'código'],
				provider: 'blackbox',
				home_page: 'https://www.blackbox.ai/'
			},
			'ru-RU': {
				name: config.name || config.model,
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: 'ИИ Blackbox',
				description_markdown: 'ИИ, который может отвечать на вопросы и писать код.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['blackbox', 'ии', 'код'],
				provider: 'blackbox',
				home_page: 'https://www.blackbox.ai/'
			},
			'uk-UA': {
				name: config.name || config.model,
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: 'ШІ Blackbox',
				description_markdown: 'ШІ, який може відповідати на запитання та писати код.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['blackbox', 'ші', 'код'],
				provider: 'blackbox',
				home_page: 'https://www.blackbox.ai/'
			},
			'vi-VN': {
				name: config.name || config.model,
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: 'AI hộp đen',
				description_markdown: 'Một AI có thể trả lời câu hỏi và viết mã.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['hộp đen', 'ai', 'mã'],
				provider: 'blackbox',
				home_page: 'https://www.blackbox.ai/'
			},
			'zh-TW': {
				name: config.name || config.model,
				avatar: 'https://www.blackbox.ai/favicon.svg',
				description: '黑盒子 AI',
				description_markdown: '一個可以回答問題和編寫程式碼的人工智慧。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['黑盒子', 'ai', '程式碼'],
				provider: 'blackbox',
				home_page: 'https://www.blackbox.ai/'
			}
		},
		is_paid: false,
		extension: {},
		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<{content: string}>} AI 的返回结果。
		 */
		Call: async prompt => {
			const result = await with_timeout(config.timeout || 10000, blackbox.call(prompt, config.model))
			return {
				content: result,
			}
		},
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @returns {Promise<{content: string}>} AI 的返回结果。
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

			let text = await with_timeout(config.timeout || 10000, blackbox.call(messages, config.model))

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
			 * @param {string} prompt - 要计算令牌数的提示。
			 * @returns {Promise<number>} 令牌数。
			 */
			get_token_count: prompt => blackbox.countTokens(prompt)
		}
	}

	return result
}
