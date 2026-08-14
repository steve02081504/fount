import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { defaultConvertConfig } from '../proxy/src/convertConfig.mjs'
import { createOpenAICompatibleSource } from '../proxy/src/openaiCompatibleSource.mjs'

import { cloudflareWorkersAiUrl } from './src/url.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * Cloudflare Workers AI 配置模板。
 */
const configTemplate = {
	name: 'Cloudflare Workers AI',
	model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
	account_id: process.env.CLOUDFLARE_ACCOUNT_ID || '',
	apikey: process.env.CLOUDFLARE_API_TOKEN || '',
	sessionAffinity: '',
	model_arguments: {},
	custom_headers: {},
	convert_config: defaultConvertConfig(),
	use_stream: true,
}

/**
 * Cloudflare Workers AI 生成器。
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * 配置页：缺账号或 token 时提示。
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
 * 创建 Workers AI 源。
 * @param {object} config - 配置。
 * @param {{ SaveConfig: () => Promise<void> }} deps - 依赖。
 * @returns {Promise<import('../../../../../decl/AIsource.ts').AIsource_t>} AI 源。
 */
async function GetSource(config, { SaveConfig }) {
	config.sessionAffinity ||= crypto.randomUUID()
	config.url = cloudflareWorkersAiUrl(config.account_id)
	config.custom_headers = {
		...config.custom_headers,
		'x-session-affinity': config.sessionAffinity,
	}
	return createOpenAICompatibleSource({
		config,
		configTemplate,
		product_info,
		SaveConfig,
	})
}
