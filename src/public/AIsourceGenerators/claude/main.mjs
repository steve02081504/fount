import { escapeRegExp } from '../../../scripts/escape.mjs'
import { structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'

import { ClaudeAPI } from './claude_api.mjs'
import info from './info.json' with { type: 'json' }
import info_dynamic from './info.dynamic.json' with { type: 'json' }
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

/**
 * @type {import('../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info,
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
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config.name || config.model
			return [k, v]
		})),
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
