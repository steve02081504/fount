import { defineReplyHandlers } from '../../shells/chat/src/reply/defineReplyHandler.mjs'
import { defineReplyPreviews } from '../../shells/chat/src/streaming/index.mjs'

import { fileOperationsReplyHandlers } from './handler.mjs'
import { getFileOperationsPrompt } from './prompt.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/** 组合后的 file-operations ReplyHandler。 */
const fileOperationsReplyHandler = defineReplyHandlers(fileOperationsReplyHandlers)

/**
 * 文件操作插件主模块。
 * @returns {import('../../../../../src/decl/pluginAPI.ts').PluginAPI_t} 插件 API 对象。
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
			GetReplyPreviewUpdater: defineReplyPreviews(fileOperationsReplyHandler),
		},
	},
}
