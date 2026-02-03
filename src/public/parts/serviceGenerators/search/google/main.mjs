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
			GetConfigDisplayContent: async () => ({}),
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
	name: 'google-search',
}

/**
 * 获取搜索源。
 * @param {object} config - 配置对象。
 * @returns {Promise<SearchSource_t>} 搜索源。
 */
async function GetSource(config) {
	/** @type {SearchSource_t} */
	const result = {
		type: 'web-search',
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config?.name || 'Google Search'
			return [k, v]
		})),
		is_paid: false,
		extension: {},
		/**
		 * 执行搜索。
		 * @param {string} query - 搜索查询字符串。
		 * @param {object} [options] - 搜索选项。
		 * @returns {Promise<import('../../../../../decl/SearchSource.ts').SearchResults_t>} 搜索结果。
		 */
		Search: async (query, options = {}) => {
			const { search, OrganicResult } = await import('npm:google-sr@^6.0.0')
			const limit = options.limit || Infinity

			const queryResult = await search({
				query,
				parsers: [OrganicResult],
				requestConfig: {},
			})

			const organicResults = queryResult.filter(item => !item.isAd).slice(0, limit)

			return {
				query,
				results: organicResults.map(item => ({
					title: item.title || '',
					link: item.link || '',
					description: item.description || '',
					source: item.source || '',
					isAd: item.isAd || false
				}))
			}
		},
		interfaces: {}
	}
	return result
}
