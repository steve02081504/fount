import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { GetSource as claudeApiGetSource } from '../claude-api/main.mjs'
import { defaultConvertConfig } from '../proxy/src/convertConfig.mjs'
import { createOpenAICompatibleSource } from '../proxy/src/openaiCompatibleSource.mjs'

import { cloudflareGatewayRoute } from './src/route.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * Cloudflare AI Gateway 配置模板。
 */
const configTemplate = {
	name: 'Cloudflare AI Gateway',
	model: 'openai/gpt-4.1',
	account_id: process.env.CLOUDFLARE_ACCOUNT_ID || '',
	gateway_id: process.env.CLOUDFLARE_AI_GATEWAY_ID || '',
	apikey: process.env.CLOUDFLARE_API_TOKEN || '',
	model_arguments: {},
	custom_headers: {},
	convert_config: defaultConvertConfig(),
	use_stream: true,
}

/**
 * Cloudflare AI Gateway 生成器。
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * 配置页：缺账号 / gateway / token 时提示。
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
 * 创建 AI Gateway 源。
 * @param {object} config - 配置。
 * @param {{ SaveConfig: () => Promise<void> }} deps - 依赖。
 * @returns {Promise<import('../../../../../decl/AIsource.ts').AIsource_t>} AI 源。
 */
async function GetSource(config, { SaveConfig }) {
	config.convert_config = { ...configTemplate.convert_config, ...config.convert_config }
	const route = cloudflareGatewayRoute({
		accountId: config.account_id,
		gatewayId: config.gateway_id,
		model: config.model,
	})
	const gatewayHeaders = {
		'cf-aig-authorization': `Bearer ${config.apikey}`,
		...config.custom_headers,
	}
	if (route.channel === 'anthropic')
		return claudeApiGetSource({
			...config,
			model: route.model,
			base_url: route.url,
			apikey: config.apikey,
		}, {
			product_info,
			clientOptions: {
				defaultHeaders: gatewayHeaders,
			},
		})

	config.model = route.model
	config.url = route.url
	config.custom_headers = gatewayHeaders
	return createOpenAICompatibleSource({
		config,
		configTemplate,
		product_info,
		SaveConfig,
	})
}
