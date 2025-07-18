import { escapeRegExp } from '../../../scripts/regex.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/server/prompt_struct.mjs'
import { DuckDuckGoAPI } from './duckduckgo.mjs'

/**
 * @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t
 * @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t
 */

export default {
	interfaces: {
		AIsource: {
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
 * @returns {AIsource_t} AI 来源对象
 */
async function GetSource(config) {
	const duckduckgo = new DuckDuckGoAPI(config)

	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'': {
				avatar: '', // 可以设置一个默认头像
				name: config.name || config.model || 'DuckDuckGo',
				provider: 'DuckDuckGo',
				description: 'DuckDuckGo AI Chat',
				description_markdown: 'DuckDuckGo AI Chat',
				version: '0.1.0',
				author: 'steve02081504',
				home_page: 'https://duckduckgo.com/', // DuckDuckGo 的主页
				tags: ['DuckDuckGo'],
			}
		},
		is_paid: false,
		extension: {},

		Unload: () => {
			// 在这里执行清理操作，如果有必要的话
		},

		Call: async (prompt) => {
			const messages = [{ role: 'user', content: prompt }] // 将字符串 prompt 包装成一个消息对象
			const model = config.model || 'gpt-4o-mini'
			const returnStream = config?.stream || false
			const result = await duckduckgo.call(messages, model, returnStream)
			return {
				content: result,
			}
		},

		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			const messages = []
			margeStructPromptChatLog(prompt_struct).forEach((chatLogEntry) => {
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
				const isMutiChar = new Set(prompt_struct.chat_log.map((chatLogEntry) => chatLogEntry.name).filter(Boolean)).size > 2
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
						(stringOrReg) => {
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
			free: () => 0,
			encode: (prompt) => prompt,
			decode: (tokens) => tokens,
			decode_single: (token) => token,
			get_token_count: (prompt) => duckduckgo.countTokens(prompt)
		}
	}

	return result
}
