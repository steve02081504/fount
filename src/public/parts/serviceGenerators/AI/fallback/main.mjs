/**
 * AI 源类型别名。
 * @typedef {import('../../../../../decl/AIsource.ts').AIsource_t} AIsource_t
 */
/**
 * 提示词结构类型别名。
 * @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t
 */

import { loadAIsourceFromNameOrConfigData } from '../../../serviceSources/AI/main.mjs'
import { identityTokenizer, minKnownContextSize } from '../proxy/src/identityTokenizer.mjs'

import { buildPromptInOrder } from './prompt.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * Fallback AI 来源生成器模块定义。
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
	name: 'fallback array',
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
		context_size: minKnownContextSize(sources),

		/**
		 * 卸载 AI 源。
		 * @returns {Promise<void[]>} 一个 Promise，在所有未命名源卸载后解析。
		 */
		Unload: () => Promise.all(unnamedSources.map(source => source.Unload())),
		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<any>} 来自 AI 的结果。
		 */
		Call: async prompt => {
			if (!sources.length) throw new Error('no source selected')
			let index = 0
			while (true) try {
				return await sources[index].Call(prompt)
			} catch (e) {
				index++
				if (index >= config.sources.length) throw new Error('all sources failed')
				console.error(e)
			}
		},
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @param {import('../../../../../decl/AIsource.ts').GenerationOptions} [options] - 生成选项。
		 * @returns {Promise<any>} 来自 AI 的结果。
		 */
		StructCall: async (prompt_struct, options = {}) => {
			if (!sources.length) throw new Error('no source selected')
			let index = 0
			while (true) try {
				return await sources[index].StructCall(prompt_struct, options)
			} catch (e) {
				index++
				if (index >= config.sources.length) throw new Error('all sources failed')
				console.error(e)
			}
		},
		/**
		 * 按 StructCall 的故障转移顺序委托内层源构建 prompt 结构。
		 * @param {prompt_struct_t} prompt_struct - 结构化提示。
		 * @returns {Promise<object|unknown[]>} 构建结果。
		 */
		BuildPrompt: prompt_struct => buildPromptInOrder(sources, prompt_struct),
		tokenizer: identityTokenizer,
	}
	return result
}
