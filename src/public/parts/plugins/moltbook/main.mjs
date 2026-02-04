import { defineToolUseBlocks } from '../../shells/chat/src/stream.mjs'

import { moltbookReplyHandler } from './handler.mjs'
import info from './info.json' with { type: 'json' }
import { getMoltbookPrompt } from './prompt.mjs'

/** 插件配置：按角色存储的 Moltbook 密钥（由 SetData 注入，GetData 返回；ReplyHandler 从 parts_config 按用户读取） */
let pluginData = { apikeys: {} }

/**
 * Moltbook 插件主模块。
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
			 * 返回当前插件配置（按角色的 Moltbook 密钥）。
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
			GetPrompt: getMoltbookPrompt,
			ReplyHandler: moltbookReplyHandler,
			GetReplyPreviewUpdater: defineToolUseBlocks([
				{ start: '<moltbook_', end: /\/>|<\/moltbook_\w+>/ },
			]),
		},
	},
}
