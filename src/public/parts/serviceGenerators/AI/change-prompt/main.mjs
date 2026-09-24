/**
 * AI 源类型别名。
 * @typedef {import('../../../../../decl/AIsource.ts').AIsource_t} AIsource_t
 */
/**
 * 提示词结构类型别名。
 * @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t
 */

import { parseRegexFromString } from '../../../../../scripts/regex.mjs'
import { loadAIsourceFromNameOrConfigData } from '../../../serviceSources/AI/main.mjs'

import { buildChangedPromptStruct, buildPromptChanged } from './prompt.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * Change Prompt AI 来源生成器模块定义。
 * @type {import('../../../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
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
\${other_chars_prompts}
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
	/**
	 * AI 源实例。
	 * @type {AIsource_t}
	 */
	const result = {
		type: 'text-chat',
		info: Object.fromEntries(Object.entries(structuredClone(product_info)).map(([k, v]) => {
			v.name = config.name
			v.provider = config.provider || 'unknown'
			return [k, v]
		})),
		is_paid: false,
		extension: {},
		context_size: base_source.context_size,

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
		 * @param {import('../../../../../decl/AIsource.ts').GenerationOptions} [options] - 生成选项。
		 * @returns {Promise<{content: string}>} AI 的返回结果。
		 */
		StructCall: async (prompt_struct, options = {}) => {
			const new_prompt_struct = await buildChangedPromptStruct(prompt_struct, config)
			const result = await base_source.StructCall(new_prompt_struct, options)
			for (const replace of config.replaces) {
				const reg = parseRegexFromString(replace.seek)
				result.content = result.content.replace(reg, replace.replace)
			}
			return result
		},
		/**
		 * 应用相同的 prompt 变换后委托基础源构建 prompt 结构。
		 * @param {prompt_struct_t} prompt_struct - 结构化提示。
		 * @returns {Promise<object|unknown[]>} 构建结果。
		 */
		BuildPrompt: prompt_struct => buildPromptChanged(prompt_struct, config, base_source),
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
