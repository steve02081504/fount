/** @typedef {import('../../../../../decl/SearchSource.ts').SearchSource_t} SearchSource_t */

import { loadSearchSourceFromNameOrConfigData } from '../../../serviceSources/search/main.mjs'

import info_dynamic from './info.dynamic.json' with { type: 'json' }
import info from './info.json' with { type: 'json' }
/**
 * @type {import('../../../../../decl/SearchSourceGenerator.ts').SearchSourceGenerator_t}
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * 获取此搜索源的配置模板。
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
 * 获取搜索源。
 * @param {object} config - 配置对象。
 * @param {object} root0 - 根对象。
 * @param {string} root0.username - 用户名。
 * @param {Function} root0.SaveConfig - 保存配置的函数。
 * @returns {Promise<SearchSource_t>} 搜索源。
 */
async function GetSource(config, { username, SaveConfig }) {
	const unnamedSources = []
	const weightedSources = await Promise.all(config.sources.map(async item => {
		if (typeof item.weight !== 'number' || item.weight <= 0)
			throw new Error(`Source item must have a positive numerical 'weight'. Invalid item: ${JSON.stringify(item.source)}`)
		const sourceInstance = await loadSearchSourceFromNameOrConfigData(username, item.source, unnamedSources, {
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
	 * @returns {SearchSource_t} 选择的源。
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


	/** @type {SearchSource_t} */
	const result = {
		type: 'web-search',
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config.name
			return [k, v]
		})),
		is_paid: weightedSources.some(s => s.source.is_paid),

		/**
		 * 卸载搜索源。
		 * @returns {Promise<void[]>} 一个 Promise，在所有未命名源卸载后解析。
		 */
		Unload: () => Promise.all(unnamedSources.map(source => source?.Unload?.())),
		/**
		 * 执行搜索。
		 * @param {string} query - 搜索查询字符串。
		 * @param {object} [options] - 搜索选项。
		 * @returns {Promise<import('../../../../../decl/SearchSource.ts').SearchResults_t>} 搜索结果。
		 */
		Search: async (query, options = {}) => {
			const selectedSource = selectSourceByWeight()
			return await selectedSource.Search(query, options)
		},
		interfaces: {}
	}
	return result
}
