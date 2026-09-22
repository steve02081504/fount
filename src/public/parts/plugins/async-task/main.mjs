/**
 * 【文件】src/public/parts/plugins/async-task/main.mjs
 * 【职责】async-task 插件入口：启用统一异步工具标记，暴露聊天接口（GetPrompt、ReplyHandler）。
 * 【原理】Load 时置位 registry 的工具可用标记，供 code-execution 判断是否接受 `async="true"`；Unload 复位。
 * 【数据结构】default export 实现 PluginAPI_t：{ info, Load, Unload, interfaces: { chat } }。
 * 【关联】registry.mjs、prompt.mjs、handler.mjs；插件加载见 src/server/parts_loader.mjs。
 */
import { asyncTaskReplyHandlers } from './handler.mjs'
import { getAsyncTaskPrompt } from './prompt.mjs'
import { setAsyncToolingEnabled } from './registry.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 插件加载钩子：启用统一异步工具。
 * @returns {Promise<void>}
 */
export async function Load() {
	setAsyncToolingEnabled(true)
}

/**
 * 插件卸载钩子：停用统一异步工具。
 * @returns {Promise<void>}
 */
export async function Unload() {
	setAsyncToolingEnabled(false)
}

/**
 * async-task 插件默认导出：暴露聊天接口。
 */
export default {
	info,
	Load,
	Unload,
	interfaces: {
		chat: {
			GetPrompt: getAsyncTaskPrompt,
			ReplyHandler: asyncTaskReplyHandlers,
		},
	},
}
