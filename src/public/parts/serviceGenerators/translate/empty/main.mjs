/** @typedef {import('../../../../../decl/TranslateSource.ts').TranslateSource_t} TranslateSource_t */
import info_dynamic from './info.dynamic.json' with { type: 'json' }
import info from './info.json' with { type: 'json' }

/**
 * @type {import('../../../../../decl/TranslateSourceGenerator.ts').TranslateSourceGenerator_t}
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * 获取此翻译源的配置显示内容。
			 * @returns {Promise<object>} 配置显示内容。
			 */
			GetConfigDisplayContent: async () => ({
				html: /* html */ '<div class="text-warning" data-i18n="serviceSource_manager.common_config_interface.empty_generator"></div>'
			}),
			/**
			 * 获取此翻译源的配置模板。
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
 * 获取翻译源。
 * @param {object} config - 配置对象。
 * @returns {Promise<TranslateSource_t>} 翻译源。
 */
async function GetSource(config) {
	const error = new Error('This is an empty translate source, which is a placeholder for a previously used generator that error in loading or has been uninstalled or renamed. Please select a new generator.')
	/** @type {TranslateSource_t} */
	const result = {
		type: 'web-translate',
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config?.name || 'Empty'
			return [k, v]
		})),
		is_paid: false,
		extension: {},
		/**
		 * 执行翻译。
		 * @param {string} text - 要翻译的文本。
		 * @param {object} [options] - 翻译选项。
		 * @returns {Promise<never>} 抛出错误。
		 */
		Translate: async (text, options = {}) => {
			throw error
		},
		interfaces: {}
	}
	return result
}
