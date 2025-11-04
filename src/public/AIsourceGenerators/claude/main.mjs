// main.mjs
import { escapeRegExp } from '../../../scripts/escape.mjs'
import { structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'

import { ClaudeAPI } from './claude_api.mjs'

/**
 * @type {import('../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
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
	name: 'Claude',
	model: 'claude-3-sonnet',
	timeout: 10000,
	cookie_array: [], // 填入你的 Cookie, 格式: ["sessionKey=sk-ant-sid01-..."]
	cookie_counter: 3,
	proxy_password: '',
	r_proxy: '', // 代理
	renew_always: false,       // 是否总是创建新对话, 默认为 false
	prevent_imperson: true, // 是否阻止角色扮演, 默认为 true
}
/**
 * 获取 AI 源。
 * @param {object} config - 配置对象。
 * @param {object} root0 - 根对象。
 * @param {Function} root0.SaveConfig - 保存配置的函数。
 * @returns {Promise<import('../../../decl/AIsource.ts').AIsource_t>} AI 源。
 */
async function GetSource(config, { SaveConfig }) { // 接收 SaveConfig
	const { countTokens } = await import('npm:@anthropic-ai/tokenizer')
	const claudeAPI = new ClaudeAPI(config, SaveConfig) // 传入 SaveConfig

	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'en-UK': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Claude by Anthropic',
				description_markdown: 'A powerful AI assistant from Anthropic.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ai'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
			},
			'zh-CN': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Anthropic 的 Claude',
				description_markdown: '来自 Anthropic 的强大 AI 助手。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ai'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
			},
			'ar-SA': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'كلود بواسطة الأنثروبيك',
				description_markdown: 'مساعد ذكاء اصطناعي قوي من Anthropic.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['كلود', 'أنثروبيك', 'ذكاء اصطناعي'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
			},
			'de-DE': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Claude von Anthropic',
				description_markdown: 'Ein leistungsstarker KI-Assistent von Anthropic.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ki'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
			},
			emoji: {
				name: '🤖',
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Claude by Anthropic',
				description_markdown: 'A powerful AI assistant from Anthropic.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ai'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
			},
			'es-ES': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Claude de Anthropic',
				description_markdown: 'Un potente asistente de IA de Anthropic.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ia'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
			},
			'fr-FR': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Claude par Anthropic',
				description_markdown: 'Un puissant assistant IA d\'Anthropic.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ia'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
			},
			'hi-IN': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'एंथ्रोपिक द्वारा क्लाउड',
				description_markdown: 'एंथ्रोपिक का एक शक्तिशाली एआई सहायक।',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['क्लाउड', 'एंथ्रोपिक', 'एआई'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
			},
			'is-IS': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Claude frá Anthropic',
				description_markdown: 'Öflugur gervigreindaraðstoðarmaður frá Anthropic.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'gervigreind'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
			},
			'it-IT': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Claude di Anthropic',
				description_markdown: 'Un potente assistente AI di Anthropic.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ia'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
			},
			'ja-JP': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'アンソロピックのクロード',
				description_markdown: 'アンソロピックの強力な AI アシスタント。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['クロード', 'アンソロピック', 'ai'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
			},
			'ko-KR': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: '앤트로픽의 클로드',
				description_markdown: '앤트로픽의 강력한 AI 비서입니다.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['클로드', '앤트로픽', 'ai'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
			},
			lzh: {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: '人擇之克勞德',
				description_markdown: '人擇之強智械佐。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['克勞德', '人擇', '智械'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
			},
			'nl-NL': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Claude van Anthropic',
				description_markdown: 'Een krachtige AI-assistent van Anthropic.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ai'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
			},
			'pt-PT': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Claude da Anthropic',
				description_markdown: 'Um poderoso assistente de IA da Anthropic.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ia'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
			},
			'ru-RU': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Клод от Anthropic',
				description_markdown: 'Мощный помощник ИИ от Anthropic.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['клод', 'anthropic', 'ии'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
			},
			'uk-UA': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Клод від Anthropic',
				description_markdown: 'Потужний помічник ШІ від Anthropic.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['клод', 'anthropic', 'ші'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
			},
			'vi-VN': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Claude của Anthropic',
				description_markdown: 'Một trợ lý AI mạnh mẽ của Anthropic.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ai'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
			},
			'zh-TW': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Anthropic 的 Claude',
				description_markdown: '來自 Anthropic 的強大 AI 助理。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ai'],
				provider: 'anthropic',
				home_page: 'https://claude.ai/'
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
			const messages = [{ role: 'user', content: prompt }]
			const system_prompt = 'You are a helpful assistant.' //Call方法可以加个默认的system
			if (system_prompt)
				messages.unshift({  //系统信息置顶
					role: 'system',
					content: system_prompt
				})
			const result = await claudeAPI.callClaudeAPI(messages, config.model)
			return { content: result }
		},

		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			const messages = []
			prompt_struct.chat_log.forEach(chatLogEntry => {
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

			// 系统 Prompt (如果需要的话)
			const system_prompt = structPromptToSingleNoChatLog(prompt_struct)
			if (system_prompt)
				messages.unshift({
					role: 'system',
					content: system_prompt
				})


			let text = await claudeAPI.callClaudeAPI(messages, config.model)

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
			encode: prompt => prompt, // 实际上不需要
			/**
			 * 解码令牌。
			 * @param {string} tokens - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode: tokens => tokens, // 实际上不需要
			/**
			 * 解码单个令牌。
			 * @param {string} token - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode_single: token => token, // 实际上不需要
			/**
			 * 获取令牌计数。
			 * @param {string} prompt - 要计算令牌的提示。
			 * @returns {number} 令牌数。
			 */
			get_token_count: prompt => countTokens(prompt),
		}
	}

	return result
}
