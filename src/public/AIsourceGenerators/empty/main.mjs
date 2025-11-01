/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */

/**
 * @type {import('../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	interfaces: {
		AIsource: {
			/**
			 * 获取此 AI 源的配置显示内容。
			 * @returns {Promise<object>} 配置显示内容。
			 */
			GetConfigDisplayContent: async () => ({
				html: '<div class="text-warning" data-i18n="aisource_editor.common_config_interface.empty_generator"></div>'
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
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'': {
				avatar: '',
				name: config.name || 'Empty',
				provider: 'fount',
				description: 'Empty AI Source',
				description_markdown: 'A placeholder for a missing AI source generator.',
				version: '0.0.1',
				author: 'steve02081504',
				home_page: '',
				tags: ['empty', 'placeholder'],
			}
		},
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
		tokenizer: {
			/**
			 * 释放分词器。
			 * @returns {number} 0
			 */
			free: () => 0,
			/**
			 * 编码提示。
			 * @param {string} prompt - 要编码的提示。
			 * @returns {string} 编码后的提示。
			 */
			encode: prompt => prompt,
			/**
			 * 解码令牌。
			 * @param {string} tokens - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode: tokens => tokens,
			/**
			 * 解码单个令牌。
			 * @param {string} token - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode_single: token => token,
			/**
			 * 获取令牌计数。
			 * @param {string} prompt - 要计算令牌的提示。
			 * @returns {number} 令牌数。
			 */
			get_token_count: prompt => prompt.length
		}
	}
	return result
}
