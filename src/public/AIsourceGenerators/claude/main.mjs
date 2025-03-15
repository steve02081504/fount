// main.mjs
import { escapeRegExp } from "../../scripts/regex.mjs";
import { structPromptToSingleNoChatLog } from '../../shells/chat/src/server/prompt_struct.mjs'
import { ClaudeAPI } from './claude_api.mjs'

export default {
	GetConfigTemplate: async () => {
		return {
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
	},

	GetSource: async (config, { SaveConfig }) => { // 接收 SaveConfig
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
					homepage: '',
					tags: ['Claude'],
				}
			},
			is_paid: false,
			extension: {},

			Unload: () => { },

			Call: async (prompt) => {
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
				prompt_struct.chat_log.forEach((chatLogEntry) => {
					messages.push({
						role: chatLogEntry.role === 'user' ? 'user' : chatLogEntry.role === 'system' ? 'system' : 'assistant',
						content: chatLogEntry.content
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

				{
					text = text.split('\n')
					const base_reg = `^(|${[...new Set([
						prompt_struct.Charname,
						...prompt_struct.chat_log.map((chatLogEntry) => chatLogEntry.name),
					])].filter(Boolean).map(escapeRegExp).concat([
						...(prompt_struct.alternative_charnames || []).map(Object).map(
							(stringOrReg) => {
								if (stringOrReg instanceof String) return escapeRegExp(stringOrReg)
								return stringOrReg.source
							}
						),
					].filter(Boolean)).join('|')}[^\\n：:]*)(:|：)\\s*`
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
				free: () => 0,
				encode: (prompt) => prompt, // 实际上不需要
				decode: (tokens) => tokens, // 实际上不需要
				decode_single: (token) => token, // 实际上不需要
				get_token_count: (prompt) => prompt.length, // 粗略估算
			}
		}

		return result
	}
}
