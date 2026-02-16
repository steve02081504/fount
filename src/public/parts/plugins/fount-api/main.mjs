import { loadData } from '../../../../server/setting_loader.mjs'

import { fountApiReplyHandler } from './handler.mjs'
import info from './info.json' with { type: 'json' }
import { getFountApiPrompt } from './prompt.mjs'

/** 插件配置：按角色存储的 fount API 密钥 */
let pluginData = { apikeys: {} }

/**
 * fount API 插件主模块。
 * @returns {import('../../../../decl/pluginAPI.ts').PluginAPI_t} 插件 API 对象。
 */
export default {
	info,
	/**
	 * 插件加载时调用。
	 * @returns {Promise<void>}
	 */
	Load: async () => { },
	/**
	 * 插件卸载时调用。
	 * @returns {Promise<void>}
	 */
	Unload: async () => { },
	interfaces: {
		config: {
			/**
			 * 返回当前插件配置（按角色的 fount API 密钥）。
			 * @returns {Promise<{ apikeys: object }>} 包含 apikeys 的配置对象。
			 */
			GetData: async () => ({ apikeys: { ...pluginData.apikeys } }),
			/**
			 * 设置插件配置。
			 * @param {{ apikeys?: object }} data - 新配置，含 apikeys 等。
			 * @returns {Promise<void>}
			 */
			SetData: async (data) => {
				pluginData = { apikeys: data?.apikeys ?? {} }
			},
		},
		chat: {
			GetPrompt: getFountApiPrompt,
			ReplyHandler: fountApiReplyHandler,
			/**
			 * 获取 JS 代码上下文，提供 fountApiKey 变量。
			 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} args - 聊天回复请求参数。
			 * @returns {Promise<Record<string, any>>} JS 代码上下文对象。
			 */
			GetJSCodeContext: async (args) => {
				const parts_config = loadData(args.username, 'parts_config')
				const apikeys = parts_config['plugins/fount-api']?.apikeys ?? {}
				const apiKey = apikeys[args.char_id]
				if (!apiKey) return {}
				return { fountApiKey: apiKey }
			},
		},
	},
}
