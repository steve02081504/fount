import fs from 'node:fs'
import path from 'node:path'

import { copilotBaseUrl, COPILOT, ensureOAuthCredentials } from '../../../shells/oauth_handler/src/providers.mjs'
import { defaultConvertConfig } from '../proxy/src/convertConfig.mjs'
import { createOpenAICompatibleSource } from '../proxy/src/openaiCompatibleSource.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * GitHub Copilot 配置模板。
 */
const configTemplate = {
	name: 'GitHub Copilot',
	model: 'gpt-4.1',
	enterpriseUrl: '',
	model_arguments: {},
	custom_headers: {},
	convert_config: defaultConvertConfig(),
	use_stream: true,
}

/**
 * GitHub Copilot 生成器。
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * 配置页：OAuth 登录。
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
 * 创建 Copilot AI 源。
 * @param {object} config - 配置。
 * @param {{ SaveConfig: () => Promise<void> }} deps - 依赖。
 * @returns {Promise<import('../../../../../decl/AIsource.ts').AIsource_t>} AI 源。
 */
async function GetSource(config, { SaveConfig }) {
	config.custom_headers = { ...configTemplate.custom_headers, ...config.custom_headers }
	return createOpenAICompatibleSource({
		config,
		configTemplate,
		product_info,
		SaveConfig,
		/**
		 * 刷新 Copilot token 并写 URL/头。
		 * @returns {Promise<void>}
		 */
		prepare: async () => {
			const creds = await ensureOAuthCredentials(config, COPILOT.id, SaveConfig)
			config.apikey = creds.access
			config.url = `${copilotBaseUrl(creds.access, creds.enterpriseUrl || config.enterpriseUrl)}/chat/completions`
			config.custom_headers = { ...COPILOT.headers, ...config.custom_headers }
		},
	})
}
