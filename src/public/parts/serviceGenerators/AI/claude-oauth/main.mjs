import fs from 'node:fs'
import path from 'node:path'

import { ANTHROPIC, ensureOAuthCredentials } from '../../../shells/oauth_handler/src/providers.mjs'
import { GetSource as claudeApiGetSource } from '../claude-api/main.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * Claude OAuth 配置模板。
 */
const configTemplate = {
	name: 'Claude Pro/Max',
	model: 'claude-sonnet-4-5',
	model_arguments: {},
	use_stream: true,
}

/**
 * Claude Pro/Max OAuth 生成器（extra usage，不伪装官方 CLI）。
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
 * 创建 Claude OAuth AI 源。
 * @param {object} config - 配置。
 * @param {{ SaveConfig: () => Promise<void> }} deps - 依赖。
 * @returns {Promise<import('../../../../../decl/AIsource.ts').AIsource_t>} AI 源。
 */
async function GetSource(config, { SaveConfig }) {
	const { default: Anthropic } = await import('npm:@anthropic-ai/sdk')
	return claudeApiGetSource(config, {
		product_info,
		/**
		 * 刷新 OAuth 后构造 Anthropic 客户端。
		 * @returns {Promise<any>} 客户端。
		 */
		getClient: async () => {
			const creds = await ensureOAuthCredentials(config, ANTHROPIC.id, SaveConfig)
			return new Anthropic({
				authToken: creds.access,
				defaultHeaders: {
					'anthropic-beta': 'oauth-2025-04-20',
				},
			})
		},
	})
}
