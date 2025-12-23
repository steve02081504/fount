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
	name: 'brave-search',
	apiKey: '',
}

/**
 * 获取搜索源。
 * @param {object} config - 配置对象。
 * @returns {Promise<SearchSource_t>} 搜索源。
 */
async function GetSource(config) {
	if (!config.apiKey)
		throw new Error('Brave search requires apiKey')


	/** @type {SearchSource_t} */
	const result = {
		type: 'web-search',
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config.name || 'Brave Search'
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
			const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`

			const response = await fetch(url, {
				headers: {
					'X-Subscription-Token': config.apiKey,
					Accept: 'application/json'
				}
			})

			if (!response.ok)
				throw new Error(`Brave search failed: ${response.status} ${response.statusText}`)


			const data = await response.json()

			return {
				query,
				results: (data.web?.results || []).map(item => ({
					title: item.title || '',
					link: item.url || '',
					description: item.description || '',
					source: 'Brave',
					isAd: false
				})).slice(0, limit)
			}
		},
		interfaces: {}
	}
	return result
}
