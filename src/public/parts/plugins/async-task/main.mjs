/**
 * 【文件】src/public/parts/plugins/async-task/main.mjs
 * 【职责】async-task 插件入口：启用统一异步工具标记，暴露聊天接口（GetPrompt、ReplyHandler）。
 * 【原理】Load 时置位 registry 的工具可用标记，供 code-execution 判断是否接受 `async="true"`；Unload 复位。
 * 【数据结构】default export 实现 PluginAPI_t：{ info, Load, Unload, interfaces: { chat } }。
 * 【关联】registry.mjs、prompt.mjs、handler.mjs；插件加载见 src/server/parts_loader.mjs。
 */
import { asyncTaskReplyHandlers } from './handler.mjs'
import { getAsyncTaskPrompt } from './prompt.mjs'
import { setAsyncTaskNotifier, setAsyncToolingEnabled } from './registry.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 默认任务生命周期通知实现：经用户事件通道推送给宿主 shell（尽力而为）。
 * @param {{ phase: 'start' | 'settle', task: object }} event 生命周期事件
 * @returns {Promise<void>}
 */
async function notifyAsyncTask(event) {
	const username = event?.task?.owner?.username
	if (!username) return
	try {
		const { sendEventToUser } = await import('../../../../server/web_server/event_dispatcher.mjs')
		sendEventToUser(username, 'async-task', { phase: event.phase, ...event.task })
	}
	catch (error) {
		console.warn('async-task: notifyAsyncTask 失败', error)
	}
}

/**
 * 插件加载钩子：启用统一异步工具并接入生命周期通知。
 * @returns {Promise<void>}
 */
export async function Load() {
	setAsyncToolingEnabled(true)
	setAsyncTaskNotifier(notifyAsyncTask)
}

/**
 * 插件卸载钩子：停用统一异步工具并断开通知。
 * @returns {Promise<void>}
 */
export async function Unload() {
	setAsyncToolingEnabled(false)
	setAsyncTaskNotifier(null)
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
