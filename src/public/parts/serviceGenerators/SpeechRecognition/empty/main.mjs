/**
 * @typedef {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionSource_t} SpeechRecognitionSource_t
 */

import { buildSourceInfo } from '../shared/recognizeHelpers.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 空语音识别生成器。
 * @type {import('../../../../../decl/SpeechRecognitionSourceGenerator.ts').SpeechRecognitionSourceGenerator_t}
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * @returns {Promise<object>} 显示内容
			 */
			GetConfigDisplayContent: async () => ({
				html: /* html */ '<div class="text-warning" data-i18n="serviceSource_manager.common_config_interface.empty_generator"></div>'
			}),
			/**
			 * @returns {Promise<object>} 模板
			 */
			GetConfigTemplate: async () => ({
				'to de or not to de': 'this is an question'
			}),
			GetSource,
		}
	}
}

/**
 * @param {object} config 配置
 * @returns {Promise<SpeechRecognitionSource_t>} 源
 */
async function GetSource(config) {
	const error = new Error('This is an empty SpeechRecognition source, which is a placeholder for a previously used generator that error in loading or has been uninstalled or renamed. Please select a new generator.')
	return {
		type: 'speech-recognition',
		info: buildSourceInfo(product_info, { name: config.name || 'Empty' }),
		is_paid: false,
		extension: {},
		/**
		 * @returns {Promise<never>} 始终抛出错误
		 */
		Recognize: async () => {
			throw error
		},
		interfaces: {}
	}
}
