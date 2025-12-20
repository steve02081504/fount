/** @typedef {import('../../../../../decl/SearchSource.ts').SearchSource_t} SearchSource_t */
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
			 * 获取此搜索源的配置显示内容。
			 * @returns {Promise<object>} 配置显示内容。
			 */
			GetConfigDisplayContent: async () => ({
				html: /* html */ '<div class="text-warning" data-i18n="serviceSource_manager.common_config_interface.empty_generator"></div>'
			}),
			/**
			 * 获取此搜索源的配置模板。
			 * @returns {Promise<object>} 配置模板。
			 */
			GetConfigTemplate: async () => ({
				'to de or not to de': 'this is an question'
			}),
			GetSource,
		}
	}
}

/**
 * 获取搜索源。
 * @param {object} config - 配置对象。
 * @returns {Promise<SearchSource_t>} 搜索源。
 */
async function GetSource(config) {
	const error = new Error('This is an empty search source, which is a placeholder for a previously used generator that error in loading or has been uninstalled or renamed. Please select a new generator.')
	/** @type {SearchSource_t} */
	const result = {
		type: 'web-search',
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config?.name || 'Empty'
			return [k, v]
		})),
		is_paid: false,
		extension: {},
		/**
		 * 执行搜索。
		 * @param {string} query - 搜索查询字符串。
		 * @param {object} [options] - 搜索选项。
		 * @returns {Promise<never>} 抛出错误。
		 */
		Search: async (query, options = {}) => {
			throw error
		},
		interfaces: {}
	}
	return result
}
