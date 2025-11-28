/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { formatStr } from '../../../scripts/format.mjs'
import { parseRegexFromString } from '../../../scripts/regex.mjs'
import { loadAIsourceFromNameOrConfigData } from '../../../server/managers/AIsource_manager.mjs'

/**
 * 获取单一部分的提示对象。
 * @returns {{text: any[], additional_chat_log: any[], extension: {}}} 单一部分的提示对象。
 */
function getSinglePartPrompt() {
	return {
		text: [],
		additional_chat_log: [],
		extension: {},
	}
}
import info_dynamic from './info.dynamic.json' with { type: 'json' }
import info from './info.json' with { type: 'json' }

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

/**
 * 获取 AI 源。
 * @param {object} config - 配置对象。
 * @param {object} root0 - 根对象。
 * @param {string} root0.username - 用户名。
 * @param {Function} root0.SaveConfig - 保存配置的函数。
 * @returns {Promise<AIsource_t>} AI 源。
 */
async function GetSource(config, { username, SaveConfig }) {
	const unnamedSources = []
	const base_source = await loadAIsourceFromNameOrConfigData(username, config.base_source, unnamedSources, {
		SaveConfig
	})
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config.name
			v.provider = config.provider || 'unknown'
			return [k, v]
		})),
		is_paid: false,
		extension: {},

		/**
		 * 卸载 AI 源。
		 * @returns {Promise<void>}
		 */
		Unload: () => Promise.all(unnamedSources.map(source => source.Unload())),
		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<{content: string}>} AI 的返回结果。
		 */
		Call: async prompt => base_source.Call(prompt),
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @returns {Promise<{content: string}>} AI 的返回结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			const new_prompt_struct = {
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
				const { chat_log } = new_prompt_struct
				if (change.insert_depth > 0)
					// 正数表示在后插入
					if (chat_log.length > change.insert_depth)
						chat_log.splice(chat_log.length - change.insert_depth, 0, value)
					else
						chat_log.unshift(value)
				else
					// 负数表示在前插入
					if (chat_log.length > -change.insert_depth)
						chat_log.splice(-change.insert_depth, 0, value)
					else
						chat_log.push(value)
			}
			const result = await base_source.StructCall(new_prompt_struct)
			for (const replace of config.replaces) {
				const reg = parseRegexFromString(replace.seek)
				result.content = result.content.replace(reg, replace.replace)
			}
			return result
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
			 * @returns {any} 编码后的提示。
			 */
			encode: prompt => base_source.tokenizer.encode(prompt),
			/**
			 * 解码令牌。
			 * @param {any} tokens - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode: tokens => base_source.tokenizer.decode(tokens),
			/**
			 * 解码单个令牌。
			 * @param {any} token - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode_single: token => base_source.tokenizer.decode_single(token),
			/**
			 * 获取令牌计数。
			 * @param {string} prompt - 要计算令牌数的提示。
			 * @returns {Promise<number>} 令牌数。
			 */
			get_token_count: prompt => base_source.tokenizer.get_token_count(prompt),
		}
	}
	return result
}
