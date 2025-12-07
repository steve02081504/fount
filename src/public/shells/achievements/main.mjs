import { events } from '../../../server/events.mjs'

import info from './info.json' with { type: 'json' }
import { onPartInstalled, onPartUninstalled } from './src/api.mjs'
import { setEndpoints } from './src/endpoints.mjs'

/**
 * 成就Shell
 */
export default {
	info,
	/**
	 * 加载成就Shell，设置API端点并监听部件安装/卸载事件。
	 * @param {object} root0 - 参数对象。
	 * @param {object} root0.router - Express的路由实例。
	 */
	Load: ({ router }) => {
		setEndpoints(router)
		events.on('part-installed', onPartInstalled)
		events.on('part-uninstalled', onPartUninstalled)
	},
	/**
	 * 卸载成就Shell，移除事件监听器。
	 */
	Unload: () => {
		events.off('part-installed', onPartInstalled)
		events.off('part-uninstalled', onPartUninstalled)
	},
	interfaces: {
		web: {}
	}
}
