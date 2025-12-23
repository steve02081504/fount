import info_dynamic from './info.dynamic.json' with { type: 'json' }
import info from './info.json' with { type: 'json' }
/** @typedef {import('../../../../../decl/SearchSource.ts').SearchSource_t} SearchSource_t */

/**
 * @type {import('../../../../../decl/SearchSourceGenerator.ts').SearchSourceGenerator_t}
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * 获取此搜索源的配置显示内容。
			 * @returns {Promise<object>} 配置显示内容。
			 */
			GetConfigDisplayContent: async () => ({ }),
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
	name: 'google-api-search',
	apiKey: '',
	searchEngineId: '',
}

/**
 * 获取搜索源。
 * @param {object} config - 配置对象。
 * @returns {Promise<SearchSource_t>} 搜索源。
 */
async function GetSource(config) {
	if (!config.apiKey || !config.searchEngineId)
		throw new Error('Google API search requires apiKey and searchEngineId')


	/** @type {SearchSource_t} */
	const result = {
		type: 'web-search',
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config.name || 'Google API Search'
			return [k, v]
		})),
		is_paid: true,
		extension: {},
		/**
		 * 执行搜索。
		 * @param {string} query - 搜索查询字符串。
		 * @param {object} [options] - 搜索选项。
		 * @returns {Promise<import('../../../../../decl/SearchSource.ts').SearchResults_t>} 搜索结果。
		 */
		Search: async (query, options = {}) => {
			const limit = options.limit || Infinity
			const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(config.apiKey)}&cx=${encodeURIComponent(config.searchEngineId)}&q=${encodeURIComponent(query)}&num=${limit}`

			const response = await fetch(url)
			if (!response.ok)
				throw new Error(`Google API search failed: ${response.status} ${response.statusText}`)


			const data = await response.json()

			return {
				query,
				results: (data.items || []).map(item => ({
					title: item.title || '',
					link: item.link || '',
					description: item.snippet || '',
					source: 'Google',
					isAd: false
				})).slice(0, limit)
			}
		},
		interfaces: {}
	}
	return result
}
