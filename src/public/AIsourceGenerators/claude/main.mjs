// main.mjs
import { escapeRegExp } from '../../../scripts/escape.mjs'
import { structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'

import { ClaudeAPI } from './claude_api.mjs'

export default {
	interfaces: {
		AIsource: {
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
async function GetSource(config, { SaveConfig }) { // 接收 SaveConfig
	const { countTokens } = await import('npm:@anthropic-ai/tokenizer')
	const claudeAPI = new ClaudeAPI(config, SaveConfig) // 传入 SaveConfig

	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'': {
				avatar: '',
				name: config.name || config.model,
				provider: 'anthropic',
				description: 'Claude',
				description_markdown: 'Claude',
				version: '0.0.1', // Update as needed
				author: 'steve02081504',
				home_page: '',
				tags: ['Claude'],
			}
		},
		is_paid: false,
		extension: {},

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
			free: () => 0,
			encode: prompt => prompt, // 实际上不需要
			decode: tokens => tokens, // 实际上不需要
			decode_single: token => token, // 实际上不需要
			get_token_count: prompt => countTokens(prompt),
		}
	}

	return result
}
