import { defineReplyHandlers } from '../../shells/chat/src/reply/defineReplyHandler.mjs'
import { defineReplyPreviews } from '../../shells/chat/src/streaming/index.mjs'

import { fileOperationsReplyHandlers } from './handler.mjs'
import { getFileOperationsPrompt } from './prompt.mjs'
import { preloadMentionedFiles } from './src/preload.mjs'

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
			/**
			 * 每次生成（`buildPromptStruct` 之后、首次 AI 调用之前）预读最新用户消息提及的文件，
			 * 以及末尾工具输出中报错的文件（只认报错定位，普通路径不触发）。
			 * 预读以工具日志写入本轮结果，当前轮即可见并随会话落盘；远端离线等失败不影响生成。
			 * @param {import('../../../../../src/decl/pluginAPI.ts').chatReplyRequest_t} args - 聊天回复请求（含 `AddLongTimeLog`）。
			 * @returns {Promise<void>}
			 */
			BeforeReply: async args => {
				try {
					await preloadMentionedFiles(args)
				}
				catch (err) {
					console.warn('预读对话提及文件失败：', err)
				}
			},
			ReplyHandler: fileOperationsReplyHandler,
			GetReplyPreviewUpdater: defineReplyPreviews(fileOperationsReplyHandler),
		},
	},
}
