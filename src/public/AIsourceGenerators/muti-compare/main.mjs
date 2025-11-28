/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { getPartInfo } from '../../../scripts/locale.mjs'
import { getUserByUsername } from '../../../server/auth.mjs'
import { loadAIsourceFromNameOrConfigData } from '../../../server/managers/AIsource_manager.mjs'
import info from './info.json' with { type: 'json' }
import info_dynamic from './info.dynamic.json' with { type: 'json' }

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
	name: 'compare array',
	provider: 'unknown',
	sources: [
		'source name1',
		'source name2',
		{
			generator: 'some generator',
			config: {
				model_name: 'lol',
				other_datas: 'lol'
			}
		}
	],
}

/**
 * 获取 AI 源。
 * @param {object} config - 配置对象。
 * @param {object} root0 - 根对象。
 * @param {string} root0.username - 用户名。
 * @param {Function} root0.SaveConfig - 保存配置的函数。
 * @returns {Promise<AIsource_t>} 一个 Promise，解析为 AI 源。
 */
async function GetSource(config, { username, SaveConfig }) {
	const unnamedSources = []
	const sources = await Promise.all(config.sources.map(source => loadAIsourceFromNameOrConfigData(username, source, unnamedSources, {
		SaveConfig
	})))
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
		 * @returns {Promise<void[]>} 一个 Promise，在所有未命名源卸载后解析。
		 */
		Unload: () => Promise.all(unnamedSources.map(source => source.Unload())),
		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<string>} 来自 AI 的结果。
		 */
		Call: async prompt => {
			if (!sources.length) throw new Error('no source selected')
			const results = await Promise.all(sources.map(source => {
				const info = getPartInfo(source, getUserByUsername(username).locales)
				return source.Call(prompt).then(
					result => `\
**${info.name} from ${info.provider}:**
${result}
`,
					err => `\
**${info.name} from ${info.provider} error:**
\`\`\`
${err.stack || err}
\`\`\`
`
				)
			}))
			return results.join('\n')
		},
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @returns {Promise<{content: string, files: any[]}>} 来自 AI 的结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			if (!sources.length) throw new Error('no source selected')
			const files = []
			const results = await Promise.all(sources.map(source => {
				const info = getPartInfo(source, getUserByUsername(username).locales)
				return source.StructCall(prompt_struct).then(
					result => {
						let res = `\
**${info.name} from ${info.provider}:**
${result.content}
`
						if (result.files.length) {
							res += `\nfiles ${files.length} - ${files.length + result.files.length}\n`
							files.push(...result.files)
						}
						return res
					},
					err => `\
**${info.name} from ${info.provider} error:**
\`\`\`
${err.stack || err}
\`\`\`
`
				)
			}))
			return {
				content: results.join('\n'),
				files
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
			 * @param {string} prompt - 要计算令牌的提示。
			 * @returns {number} 令牌数。
			 */
			get_token_count: prompt => prompt.length
		}
	}
	return result
}
