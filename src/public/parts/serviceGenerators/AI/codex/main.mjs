import fs from 'node:fs'
import path from 'node:path'

import { CODEX, ensureOAuthCredentials } from '../../../shells/oauth_handler/src/providers.mjs'
import { defaultConvertConfig } from '../proxy/src/convertConfig.mjs'

import { createResponsesSource } from './src/responsesSource.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

/**
 * Codex 配置模板。
 */
const configTemplate = {
	name: 'ChatGPT Codex',
	model: 'gpt-5.1-codex',
	model_arguments: {},
	convert_config: defaultConvertConfig(),
	use_stream: true,
}

/**
 * ChatGPT Codex 生成器。
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
 * 创建 Codex AI 源。
 * @param {object} config - 配置。
 * @param {{ SaveConfig: () => Promise<void> }} deps - 依赖。
 * @returns {Promise<import('../../../../../decl/AIsource.ts').AIsource_t>} AI 源。
 */
async function GetSource(config, { SaveConfig }) {
	return createResponsesSource({
		config,
		configTemplate,
		product_info,
		/**
		 * 刷新 Codex token 并组装 Responses 请求。
		 * @returns {Promise<{url: string, headers: Record<string, string>}>} 请求。
		 */
		resolveRequest: async () => {
			const credentials = await ensureOAuthCredentials(config, CODEX.id, SaveConfig)
			return {
				url: CODEX_RESPONSES_URL,
				headers: {
					Authorization: `Bearer ${credentials.access}`,
					'ChatGPT-Account-Id': credentials.accountId,
					'OpenAI-Beta': 'responses=v1',
					originator: 'fount',
				},
			}
		},
	})
}
