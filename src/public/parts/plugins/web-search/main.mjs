import { loadAnyPreferredDefaultPart } from '../../../../server/parts_loader.mjs'

import { createWebSearchReplyHandler } from './handler.mjs'
import { getWebSearchPrompt } from './prompt.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

let searchSource

/**
 * 获取当前用户的默认搜索服务源。
 * @returns {object|undefined} 当前搜索源。
 */
function getSearchSource() {
	return searchSource
}

/**
 * 网络搜索插件：使用用户首选的默认搜索服务源。
 * @returns {import('../../../../decl/pluginAPI.ts').PluginAPI_t} 插件 API。
 */
export default {
	info,
	/**
	 * 加载用户的默认搜索服务源。
	 * @param {object} options - 插件加载选项。
	 * @param {string} options.username - 当前用户名。
	 * @returns {Promise<void>} 加载完成。
	 */
	Load: async ({ username }) => {
		searchSource = await loadAnyPreferredDefaultPart(username, 'serviceSources/search')
	},
	/**
	 * 清理插件持有的搜索源引用。
	 * @returns {Promise<void>} 卸载完成。
	 */
	Unload: async () => {
		searchSource = undefined
	},
	interfaces: {
		chat: {
			GetPrompt: getWebSearchPrompt,
			ReplyHandler: createWebSearchReplyHandler({ getSearchSource }),
		},
	},
}
