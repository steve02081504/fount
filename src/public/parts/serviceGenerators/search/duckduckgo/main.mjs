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
	name: 'duckduckgo-search',
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
			v.name = config.name || 'DuckDuckGo Search'
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
			const limit = options.limit || Infinity
			// DuckDuckGo 没有官方 API，使用 HTML 解析
			const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`

			const response = await fetch(url, {
				headers: {
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
				}
			})

			if (!response.ok)
				throw new Error(`DuckDuckGo search failed: ${response.status} ${response.statusText}`)


			const html = await response.text()
			let results = []

			// 简单的 HTML 解析（实际应用中可能需要更复杂的解析）
			const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g
			const descPattern = /<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/g

			let match
			const links = []
			while ((match = resultPattern.exec(html)) !== null && links.length < limit)
				links.push({
					link: match[1],
					title: match[2]
				})


			const descriptions = []
			while ((match = descPattern.exec(html)) !== null && descriptions.length < limit)
				descriptions.push(match[1])


			for (let i = 0; i < Math.min(links.length, limit); i++)
				results.push({
					title: links[i].title || '',
					link: links[i].link || '',
					description: descriptions[i] || '',
					source: 'DuckDuckGo',
					isAd: false
				})

			results = results.slice(0, limit)

			return {
				query,
				results
			}
		},
		interfaces: {}
	}
	return result
}
