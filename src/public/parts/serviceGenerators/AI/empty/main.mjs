/**
 * AI 源类型别名。
 * @typedef {import('../../../../../decl/AIsource.ts').AIsource_t} AIsource_t
 */

import { identityTokenizer } from '../proxy/src/identityTokenizer.mjs'
import { buildSourceInfo } from '../proxy/src/sourceInfo.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * Empty AI 来源生成器模块定义。
 * @type {import('../../../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * 获取此 AI 源的配置显示内容。
			 * @returns {Promise<object>} 配置显示内容。
			 */
			GetConfigDisplayContent: async () => ({
				html: /* html */ '<div class="text-warning" data-i18n="serviceSource_manager.common_config_interface.empty_generator"></div>'
			}),
			/**
			 * 获取此 AI 源的配置模板。
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
 * 获取 AI 源。
 * @param {object} config - 配置对象。
 * @returns {Promise<AIsource_t>} AI 源。
 */
async function GetSource(config) {
	const error = new Error('This is an empty AI source, which is a placeholder for a previously used generator that error in loading or has been uninstalled or renamed. Please select a new generator.')
	/**
	 * AI 源实例。
	 * @type {AIsource_t}
	 */
	const result = {
		type: 'text-chat',
		info: buildSourceInfo(product_info, config, { fallbackName: 'Empty' }),
		is_paid: false,
		extension: {},

		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<never>} 抛出错误。
		 */
		Call: async prompt => {
			throw error
		},
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {object} prompt_struct - 要发送给 AI 的结构化提示。
		 * @returns {Promise<never>} 抛出错误。
		 */
		StructCall: async prompt_struct => {
			throw error
		},
		/**
		 * 空源不构建 prompt，始终返回空对象。
		 * @param {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 结构化提示。
		 * @returns {Promise<object>} 空对象。
		 */
		BuildPrompt: async prompt_struct => ({}),
		tokenizer: identityTokenizer,
	}
	return result
}
