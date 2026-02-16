import { defineToolUseBlocks } from '../../shells/chat/src/stream.mjs'

import { fileOperationsReplyHandler } from './handler.mjs'
import info from './info.json' with { type: 'json' }
import { getFileOperationsPrompt } from './prompt.mjs'

/**
 * 文件操作插件主模块。
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
		chat: {
			GetPrompt: getFileOperationsPrompt,
			ReplyHandler: fileOperationsReplyHandler,
			GetReplyPreviewUpdater: defineToolUseBlocks([
				{ start: '<view-file>', end: '</view-file>' },
				{ start: '<replace-file>', end: '</replace-file>' },
				{ start: /<override-file[^>]*>/, end: '</override-file>' },
			]),
		},
	},
}
