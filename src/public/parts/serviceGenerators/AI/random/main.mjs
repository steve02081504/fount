/** @typedef {import('../../../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { FullProxy } from 'npm:full-proxy'

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
	name: 'weighted random',
	provider: 'unknown',
	sources: [
		{
			weight: 2,
			source: 'source name1',
		},
		{
			weight: 3,
			source: 'source name2',
		},
		{
			weight: 5,
			source: {
				generator: 'some generator',
				config: {
					model_name: 'some_model',
					other_datas: '...'
				}
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
 * @returns {Promise<AIsource_t>} AI 源。
 */
async function GetSource(config, { username, SaveConfig }) {
	const unnamedSources = []
	const weightedSources = await Promise.all(config.sources.map(async item => {
		if (Object(item.weight) instanceof Number || item.weight <= 0)
			throw new Error(`Source item must have a positive numerical 'weight'. Invalid item: ${JSON.stringify(item.source)}`)
		const sourceInstance = await loadAIsourceFromNameOrConfigData(username, item.source, unnamedSources, {
			SaveConfig
		})
		return {
			weight: item.weight,
			source: sourceInstance
		}
	}))

	if (!weightedSources.length)
		throw new Error('no source configured')

	/**
	 * 按权重选择源。
	 * @returns {AIsource_t} 选择的源。
	 */
	const selectSourceByWeight = () => {
		const totalWeight = weightedSources.reduce((sum, s) => sum + s.weight, 0)
		let randomValue = Math.random() * totalWeight

		for (const weightedSource of weightedSources) {
			randomValue -= weightedSource.weight
			if (randomValue <= 0)
				return weightedSource.source
		}
	}


	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config.name
			return [k, v]
		})),
		is_paid: weightedSources.some(s => s.source.is_paid),

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
			const selectedSource = selectSourceByWeight()
			return await selectedSource.Call(prompt)
		},
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @param {import('../../../../../decl/AIsource.ts').GenerationOptions} [options] - 生成选项。
		 * @returns {Promise<any>} 来自 AI 的结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct, options = {}) => {
			const selectedSource = selectSourceByWeight()
			return await selectedSource.StructCall(prompt_struct, options)
		},
		tokenizer: new FullProxy(() => selectSourceByWeight().tokenizer),
	}
	return result
}
