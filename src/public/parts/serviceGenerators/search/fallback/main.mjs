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
 * 获取搜索源。
 * @param {object} config - 配置对象。
 * @param {object} root0 - 根对象。
 * @param {string} root0.username - 用户名。
 * @param {Function} root0.SaveConfig - 保存配置的函数。
 * @returns {Promise<SearchSource_t>} 一个 Promise，解析为搜索源。
 */
async function GetSource(config, { username, SaveConfig }) {
	const unnamedSources = []
	const sources = await Promise.all(config.sources.map(source => loadSearchSourceFromNameOrConfigData(username, source, unnamedSources, {
		SaveConfig
	})))
	/** @type {SearchSource_t} */
	const result = {
		type: 'web-search',
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config.name
			v.provider = config.provider || 'unknown'
			return [k, v]
		})),
		is_paid: false,
		extension: {},

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
			if (!sources.length) throw new Error('no source selected')
			let index = 0
			while (true) try {
				return await sources[index].Search(query, options)
			} catch (e) {
				index++
				if (index >= config.sources.length) throw new Error('all sources failed')
				console.error(e)
			}
		},
		interfaces: {}
	}
	return result
}
