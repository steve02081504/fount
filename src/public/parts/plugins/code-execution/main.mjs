import { codeExecutionReplyHandler, GetCodeExecutionPreviewUpdater } from './handler.mjs'
import info from './info.json' with { type: 'json' }
import { getCodeExecutionPrompt } from './prompt.mjs'

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
			ReplyHandler: codeExecutionReplyHandler,
			GetReplyPreviewUpdater: GetCodeExecutionPreviewUpdater,
		},
	},
}
