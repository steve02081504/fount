// main.mjs
import { GrokAPI } from './grokAPI.mjs'
import { escapeRegExp } from '../../../../src/scripts/escape.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/server/prompt_struct.mjs'

/**
 * @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t
 * @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t
 */

export default {
	GetConfigTemplate: async () => {
		return {
			name: 'Grok',
			model: 'grok-3',
			cookies: [],
			convert_config: {
				roleReminding: true
			}
		}
	},

	/**
	 * 创建一个 Grok AI 来源生成器
	 * @param {object} config - 配置对象
	 * @param {string} [config.name] - AI 来源的名称，默认为模型名称
	 * @param {string} [config.model] - 使用的模型，默认为 'grok-3'
	 * @param {string[]} [config.cookies] - Grok Cookies 数组
	 * @returns {AIsource_t} AI 来源对象
	 */
	GetSource: async (config) => {
		const grok = new GrokAPI(config)

		/** @type {AIsource_t} */
		const result = {
			type: 'text-chat',
			info: {
				'': {
					avatar: '', // 可以设置一个默认头像
					name: config.name || config.model || 'Grok',
					provider: 'Grok',
					description: 'Grok AI Chat',
					description_markdown: 'Grok AI Chat',
					version: '0.1.0',
					author: 'Your Name',
					homepage: 'https://grok.com/',
					tags: ['Grok'],
				}
			},
			is_paid: false, // 根据实际情况设置
			extension: {},

			Unload: () => {
				// 清理操作（如果有的话）
			},

			Call: async (prompt) => {
				const messages = [{ role: 'user', content: prompt }]
				const model = config.model || 'grok-3'
				const returnStream = config?.stream || false
				const result = await grok.call(messages, model, returnStream)
				return {
					content: result,
				}
			},

			StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {

				const messages = []
				margeStructPromptChatLog(prompt_struct).forEach((chatLogEntry) => {
					messages.push({
						role: chatLogEntry.role === 'user' ? 'user' : chatLogEntry.role === 'system' ? 'system' : 'assistant',
						content: chatLogEntry.name + ':\n' + chatLogEntry.content
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
					const isMutiChar = new Set([...prompt_struct.chat_log.map((chatLogEntry) => chatLogEntry.name).filter(Boolean)]).size > 2
					if (isMutiChar)
						messages.push({
							role: 'system',
							content: `现在请以${prompt_struct.Charname}的身份续写对话。`
						})

				}

				const model = config.model || 'grok-3'
				let text = await grok.call(messages, model)

				{
					text = text.split('\n')
					const base_reg = `^((|${[...new Set([
						prompt_struct.Charname,
						...prompt_struct.chat_log.map((chatLogEntry) => chatLogEntry.name),
					])].filter(Boolean).map(escapeRegExp).concat([
						...(prompt_struct.alternative_charnames || []).map(Object).map(
							(stringOrReg) => {
								if (stringOrReg instanceof String) return escapeRegExp(stringOrReg)
								return stringOrReg.source
							}
						),
					].filter(Boolean)).join('|')})[^\\n：:\<\>\d]*)(:|：)\\s*`
					let reg = new RegExp(`${base_reg}$`, 'i')
					while (text[0].trim().match(reg)) text.shift()
					reg = new RegExp(`${base_reg}`, 'i')
					text[0] = text[0].replace(reg, '')
					text = text.join('\n')
				}
				return {
					content: text,
				}
			},

			Tokenizer: {
				free: () => 0, // 或者根据实际情况计算
				encode: (prompt) => prompt, // Grok 不需要特殊的编码
				decode: (tokens) => tokens,
				decode_single: (token) => token,
				get_token_count: (prompt) => grok.countTokens(prompt),
			},
			generateImage: async (prompt, n) => {
				const images = await grok.generateImage(prompt, n)
				return {
					data: images
				}
			}
		}

		return result
	}
}
