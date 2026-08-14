import fs from 'node:fs'
import path from 'node:path'

import { defaultConvertConfig } from './src/convertConfig.mjs'
import { createOpenAICompatibleSource } from './src/openaiCompatibleSource.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * AI 源类型别名。
 * @typedef {import('../../../../../decl/AIsource.ts').AIsource_t} AIsource_t
 */

/**
 * Proxy AI 来源生成器模块定义。
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
				js: fs.readFileSync(path.join(import.meta.dirname, 'display.mjs'), 'utf-8')
			}),
			/**
			 * 获取此 AI 源的配置模板。
			 * @returns {Promise<object>} 配置模板。
			 */
			GetConfigTemplate: async () => structuredClone(configTemplate),
			GetSource,
		}
	}
}

const configTemplate = {
	name: 'openai-proxy',
	url: process.env.OPENAI_API_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions',
	model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
	apikey: process.env.OPENAI_API_KEY || '',
	system_prompt_at_depth: 10,
	model_arguments: {
		temperature: 1,
		n: 1,
		logprobs: false,
		top_logprobs: 5,
	},
	custom_headers: {},
	convert_config: defaultConvertConfig(),
	use_stream: true,
}
/**
 * 获取 Proxy AI 源。
 * @param {object} config - 配置对象。
 * @param {object} root0 - 根对象。
 * @param {Function} root0.SaveConfig - 保存配置的函数。
 * @returns {Promise<AIsource_t>} AI 源。
 */
async function GetSource(config, { SaveConfig }) {
	return createOpenAICompatibleSource({
		config,
		configTemplate,
		product_info,
		SaveConfig,
		is_paid: false,
	})
}
