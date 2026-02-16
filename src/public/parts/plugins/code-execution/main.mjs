
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
			/**
			 * 获取 JS 代码提示。
			 * 注意：此方法不应调用其他插件的 GetJSCodePrompt，以避免无限递归。
			 * 其他插件的提示会在 prompt.mjs 中通过 buildPromptStruct 获取。
			 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} args - 聊天回复请求参数。
			 * @returns {Promise<string | undefined>} JS 代码提示或 undefined。
			 */
			GetJSCodePrompt: async (args) => {
				// 不返回任何内容，因为代码执行的提示已经在 GetPrompt 中提供了
				return undefined
			},
			/**
			 * 获取 JS 代码上下文。
			 * 注意：此方法不应调用其他插件的 GetJSCodeContext，以避免无限递归。
			 * 其他插件的上下文会在 handler.mjs 中通过遍历插件获取。
			 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} args - 聊天回复请求参数。
			 * @param {import('../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 提示结构。
			 * @returns {Promise<Record<string, any>>} JS 代码上下文对象。
			 */
			GetJSCodeContext: async (args, prompt_struct) => {
				// 不返回任何内容，因为代码执行的上下文已经在 handler.mjs 中构建了
				return {}
			},
			GetReplyPreviewUpdater: GetCodeExecutionPreviewUpdater,
		},
	},
}
