/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { loadAIsourceFromNameOrConfigData } from '../../../server/managers/AIsources_manager.mjs'
import { parseRegexFromString } from "../../scripts/regex.mjs";

function getSinglePartPrompt() {
	return {
		text: [],
		additional_chat_log: [],
		extension: {},
	}
}

export default {
	interfaces: {
		AIsource: {
			GetConfigTemplate: async () => configTemplate,
			GetSource,
		}
	}
}

const configTemplate = {
	name: 'custom prompt',
	provider: 'unknown',
	base_source: 'source name',
	build_prompt: true,
	changes: [
		{
			name: 'base defs',
			insert_depth: 7,
			content: {
				role: 'system',
				name: 'system',
				content: `\
你需要扮演的角色\${Charname}的设定如下：
\${char_prompt}
用户\${UserCharname}的设定如下：
\${user_prompt}
当前环境的设定如下：
\${world_prompt}
其他角色的设定如下：
\${other_chars_prompt}
你可以使用以下插件，方法如下：
\${plugin_prompts}
`
			}
		}
	],
	replaces: [
		{
			name: 'example',
			seek: '/<delete-me>/ig',
			replace: '',
		}
	]
}

async function formatStr(str, data) {
	const data_unpacker = `let { ${Object.keys(data).join(', ')} } = data;`
	// 使用循环匹配所有 ${...} 表达式
	let result = ''
	while (str.indexOf('${') != -1) {
		const length = str.indexOf('${')
		result += str.slice(0, length)
		str = str.slice(length + 2)
		let end_index = 0
		find: while (str.indexOf('}', end_index) != -1) { // 我们需要遍历所有的结束符直到表达式跑通
			end_index = str.indexOf('}', end_index) + 1
			const expression = str.slice(0, end_index - 1)
			try {
				const eval_result = await eval(data_unpacker + '(async ()=>(' + expression + '))()')
				result += eval_result
				str = str.slice(end_index)
				break find
			} catch (error) { }
		}
	}
	result += str
	return result
}

async function GetSource(config, { username, SaveConfig }) {
	const base_source = await loadAIsourceFromNameOrConfigData(username, config.base_source, {
		SaveConfig
	})
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'': {
				avatar: '',
				name: config.name,
				provider: config.provider || 'unknown',
				description: 'polling',
				description_markdown: 'polling',
				version: '0.0.0',
				author: 'steve02081504',
				homepage: '',
				tags: ['polling'],
			}
		},
		is_paid: false,
		extension: {},

		Unload: () => { },
		Call: async (prompt) => base_source.Call(prompt),
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			let new_prompt_struct = {
				char_id: prompt_struct.char_id,
				UserCharname: prompt_struct.UserCharname,
				ReplyToCharname: prompt_struct.ReplyToCharname,
				Charname: prompt_struct.Charname,
				char_prompt: getSinglePartPrompt(),
				user_prompt: getSinglePartPrompt(),
				other_chars_prompt: {},
				world_prompt: getSinglePartPrompt(),
				plugin_prompts: {},
				chat_log: prompt_struct.chat_log,
			}
			let eval_strings = {
				char_prompt: '',
				user_prompt: '',
				world_prompt: '',
				other_chars_prompt: '',
				plugin_prompts: '',
			}
			if (config.build_prompt) {
				{
					const sorted = prompt_struct.char_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
					eval_strings.char_prompt = sorted.join('\n')
				}

				{
					const sorted = prompt_struct.user_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
					eval_strings.user_prompt = sorted.join('\n')
				}

				{
					const sorted = prompt_struct.world_prompt.text.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
					eval_strings.world_prompt = sorted.join('\n')
				}

				{
					const sorted = Object.values(prompt_struct.other_chars_prompt).map(char => char.text).filter(Boolean).map(
						char => char.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
					).flat().filter(Boolean)
					eval_strings.other_chars_prompt = sorted.join('\n')
				}

				{
					const sorted = Object.values(prompt_struct.plugin_prompts).map(plugin => plugin?.text).filter(Boolean).map(
						plugin => plugin.sort((a, b) => a.important - b.important).map(text => text.content).filter(Boolean)
					).flat().filter(Boolean)
					eval_strings.plugin_prompts = sorted.join('\n')
				}
			}
			else {
				new_prompt_struct.char_prompt = prompt_struct.char_prompt
				new_prompt_struct.user_prompt = prompt_struct.user_prompt
				new_prompt_struct.world_prompt = prompt_struct.world_prompt
				new_prompt_struct.other_chars_prompt = prompt_struct.other_chars_prompt
				new_prompt_struct.plugin_prompts = prompt_struct.plugin_prompts
				eval_strings = {}
			}
			for (const change of config.changes) {
				const value = {
					name: 'system',
					role: 'system',
					files: [],
					extension: {},
					...change.content,
					content: await formatStr(change.content.content, {
						...eval_strings,
						...prompt_struct,
					})
				}
				const chat_log = new_prompt_struct.chat_log
				if (change.insert_depth > 0) {
					// 正数表示在后插入
					if (chat_log.length > change.insert_depth) {
						chat_log.splice(chat_log.length - change.insert_depth, 0, value)
					} else {
						chat_log.unshift(value)
					}
				}
				else {
					// 负数表示在前插入
					if (chat_log.length > -change.insert_depth) {
						chat_log.splice(-change.insert_depth, 0, value)
					} else {
						chat_log.push(value)
					}
				}
			}
			const result = await base_source.StructCall(new_prompt_struct)
			for (const replace of config.replaces) {
				const reg = parseRegexFromString(replace.seek)
				result.content = result.content.replace(reg, replace.replace)
			}
			return result
		},
		Tokenizer: {
			free: () => 0,
			encode: (prompt) => base_source.Tokenizer.encode(prompt),
			decode: (tokens) => base_source.Tokenizer.decode(tokens),
			decode_single: (token) => base_source.Tokenizer.decode_single(token),
			get_token_count: (prompt) => base_source.Tokenizer.get_token_count(prompt),
		}
	}
	return result
}
