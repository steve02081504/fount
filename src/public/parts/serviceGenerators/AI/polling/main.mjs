/** @typedef {import('../../../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { loadAIsourceFromNameOrConfigData } from '../../../serviceSources/AI/main.mjs'

import info_dynamic from './info.dynamic.json' with { type: 'json' }
import info from './info.json' with { type: 'json' }

/**
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
	name: 'polling array',
	provider: 'unknown',
	max_fail_count: 0,
	random_start: true,
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
	let index = config.random_start ?? true ? Math.floor(Math.random() * config.sources.length) : -1
	const unnamedSources = []
	const sources = await Promise.all(config.sources.map(source => loadAIsourceFromNameOrConfigData(username, source, unnamedSources, {
		SaveConfig
	})))

	const maxFailCount = Math.min(
		config.sources.length,
		config.max_fail_count || new Set(config.sources.map(source => source.generator)).size == 1 ? 3 : Infinity
	)
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config.name
			return [k, v]
		})),
		is_paid: false,
		extension: {},

		/**
		 * 卸载 AI 源。
		 * @returns {Promise<void[]>} 一个 Promise，在所有未命名源卸载后解析。
		 */
		Unload: () => Promise.all(unnamedSources.map(source => source?.Unload?.())),
		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<any>} 来自 AI 的结果。
		 */
		Call: async prompt => {
			if (!sources.length) throw new Error('no source selected')
			let error_num = 0
			while (true) try {
				index++
				index %= config.sources.length
				return await sources[index].Call(prompt)
			} catch (e) {
				console.error(e)
				error_num++
				if (error_num >= maxFailCount) throw new Error(`Too many failures (${error_num}/${maxFailCount}). Last error: ` + (e.message || e))
			}
		},
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @param {import('../../../../../decl/AIsource.ts').GenerationOptions} [options] - 生成选项。
		 * @returns {Promise<any>} 来自 AI 的结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct, options = {}) => {
			if (!sources.length) throw new Error('no source selected')
			let error_num = 0
			while (true) try {
				index++
				index %= config.sources.length
				return await sources[index].StructCall(prompt_struct, options)
			} catch (e) {
				console.error(e)
				error_num++
				if (error_num >= maxFailCount) throw new Error(`Too many failures (${error_num}/${maxFailCount}). Last error: ` + (e.message || e))
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
