import { createBrowserIntegrationReplyHandler, handleBrowserJsCallback } from './handler.mjs'
import { createBrowserIntegrationPrompt } from './prompt.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 浏览器集成插件：让角色通过浏览器集成 shell 阅读并操作已连接的浏览器页面。
 * @returns {import('../../../../decl/pluginAPI.ts').PluginAPI_t} 插件 API。
 */
export default {
	info,
	interfaces: {
		chat: {
			GetPrompt: createBrowserIntegrationPrompt(),
			ReplyHandler: createBrowserIntegrationReplyHandler(),
		},
		browserIntegration: {
			/**
			 * 处理来自浏览器用户脚本的 JS 回调。
			 * @param {object} payload - 回调数据（含 username）。
			 * @returns {Promise<void>} 处理完成。
			 */
			BrowserJsCallback: payload => handleBrowserJsCallback(payload),
		},
	},
}
