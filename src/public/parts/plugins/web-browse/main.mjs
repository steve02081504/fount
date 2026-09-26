import { createWebBrowseReplyHandler } from './handler.mjs'
import { getWebBrowsePrompt } from './prompt.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 网页浏览插件：抓取网页并转换为 Markdown 供角色阅读。
 * @returns {import('../../../../decl/pluginAPI.ts').PluginAPI_t} 插件 API。
 */
export default {
	info,
	interfaces: {
		chat: {
			GetPrompt: getWebBrowsePrompt,
			ReplyHandler: createWebBrowseReplyHandler(),
		},
	},
}
