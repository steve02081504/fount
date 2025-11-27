import info from './info.json' assert { type: 'json' };
import { events } from '../../../server/events.mjs'

import { setEndpoints } from './src/endpoints.mjs'
import { onPartInstalled, onPartUninstalled } from './src/home.mjs'

/**
 * @type {import('../../../decl/shell.ts').shell_t}
 */
export default {
	info,
	/**
	 * 加载主页Shell。
	 * 此函数设置API端点，并订阅`part-installed`和`part-uninstalled`事件，以在部件状态变更时更新主页注册表。
	 * @param {object} params - 参数对象。
	 * @param {import('npm:websocket-express').Router} params.router - Express的路由实例，用于注册API端点。
	 */
	Load: async ({ router }) => {
		setEndpoints(router)
		events.on('part-installed', onPartInstalled)
		events.on('part-uninstalled', onPartUninstalled)
	},
	/**
	 * 卸载主页Shell。
	 * 此函数会移除在加载时设置的事件监听器，以进行清理。
	 */
	Unload: async () => {
		events.off('part-installed', onPartInstalled)
		events.off('part-uninstalled', onPartUninstalled)
	},
}
