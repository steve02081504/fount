import { defineToolUseBlocks } from '../../shells/chat/src/stream.mjs'

import { moltbookReplyHandler } from './handler.mjs'
import info from './info.json' with { type: 'json' }
import { getMoltbookPrompt } from './prompt.mjs'

/** 插件配置：按角色存储的 Moltbook 密钥（由 SetData 注入，GetData 返回；ReplyHandler 从 parts_config 按用户读取） */
let pluginData = { apikeys: {} }

export default {
	info,
	Load: async () => {},
	Unload: async () => {},
	interfaces: {
		config: {
			GetData: async () => ({ apikeys: { ...pluginData.apikeys } }),
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
