import info_dynamic from './info.dynamic.json' with { type: 'json' }
import info from './info.json' with { type: 'json' }
/** @typedef {import('../../../../../decl/TranslateSource.ts').TranslateSource_t} TranslateSource_t */

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
			GetConfigDisplayContent: async () => ({}),
			/**
			 * 获取此翻译源的配置模板。
			 * @returns {Promise<object>} 配置模板。
			 */
			GetConfigTemplate: async () => configTemplate,
			GetSource,
		}
	}
}

const configTemplate = {
	name: 'google-translate',
}

/**
 * 获取翻译源。
 * @param {object} config - 配置对象。
 * @returns {Promise<TranslateSource_t>} 翻译源。
 */
async function GetSource(config) {
	/** @type {TranslateSource_t} */
	const result = {
		type: 'web-translate',
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config?.name || 'Google Translate'
			return [k, v]
		})),
		is_paid: false,
		extension: {},
		/**
		 * 执行翻译。
		 * @param {string} text - 要翻译的文本。
		 * @param {object} [options] - 翻译选项。
		 * @param {string} [options.from] - 源语言代码，'auto' 表示自动检测。
		 * @param {string} [options.to] - 目标语言代码。
		 * @returns {Promise<import('../../../../../decl/TranslateSource.ts').TranslateResult_t>} 翻译结果。
		 */
		Translate: async (text, options = {}) => {
			const { translate } = await import('npm:@vitalets/google-translate-api')
			const from = options.from || 'auto'
			const to = options.to || 'zh-CN'

			const result = await translate(text, { from, to })

			return {
				text: result.text,
				from: result.from?.language?.iso || result.from?.iso || from === 'auto' ? 'auto' : from,
				to
			}
		},
		interfaces: {}
	}
	return result
}
