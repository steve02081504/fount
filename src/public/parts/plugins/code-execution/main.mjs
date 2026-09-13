import { defineReplyHandlers } from '../../shells/chat/src/reply/defineReplyHandler.mjs'
import { defineReplyPreviews } from '../../shells/chat/src/streaming/index.mjs'

import { getCodeExecutionReplyHandlers } from './handler.mjs'
import { getCodeExecutionPrompt } from './prompt.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 代码执行插件主模块。
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
			GetPrompt: getCodeExecutionPrompt,
			/**
			 * 代码执行 ReplyHandler 组（按当前可用 shell 动态生成）。
			 * @returns {import('../../../../decl/pluginAPI.ts').ReplyHandler_t[]} handler 列表
			 */
			get ReplyHandler() {
				return defineReplyHandlers(getCodeExecutionReplyHandlers())
			},
			/**
			 * 由当前 handler 组派生回复预览更新器。
			 * @param {Function} [next] 上一个更新器
			 * @returns {Function} 新的预览更新器
			 */
			GetReplyPreviewUpdater: next => defineReplyPreviews(getCodeExecutionReplyHandlers())(next),
		},
	},
}
