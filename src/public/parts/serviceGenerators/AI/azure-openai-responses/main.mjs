import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { createResponsesSource } from '../codex/src/responsesSource.mjs'
import { defaultConvertConfig } from '../proxy/src/convertConfig.mjs'

import { azureResponsesUrl } from './src/url.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * Azure OpenAI Responses 配置模板。
 */
const configTemplate = {
	name: 'Azure OpenAI Responses',
	model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1',
	apikey: process.env.AZURE_OPENAI_API_KEY || '',
	endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
	resource: process.env.AZURE_OPENAI_RESOURCE || '',
	model_arguments: {},
	convert_config: defaultConvertConfig(),
	use_stream: true,
}

/**
 * Azure OpenAI Responses 生成器。
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * 配置页：缺 key / 端点时提示。
			 * @returns {Promise<{ js: string }>} 脚本。
			 */
			GetConfigDisplayContent: async () => ({
				js: fs.readFileSync(path.join(import.meta.dirname, 'display.mjs'), 'utf-8'),
			}),
			/**
			 * 默认配置。
			 * @returns {Promise<object>} 模板。
			 */
			GetConfigTemplate: async () => structuredClone(configTemplate),
			GetSource,
		},
	},
}

/**
 * 创建 Azure Responses AI 源。
 * @param {object} config - 配置。
 * @returns {Promise<import('../../../../../decl/AIsource.ts').AIsource_t>} AI 源。
 */
async function GetSource(config) {
	return createResponsesSource({
		config,
		configTemplate,
		product_info,
		/**
		 * 组装 Azure Responses 请求。
		 * @returns {{url: string, headers: Record<string, string>}} 请求。
		 */
		resolveRequest: () => ({
			url: azureResponsesUrl(config),
			headers: { 'api-key': config.apikey },
		}),
	})
}
