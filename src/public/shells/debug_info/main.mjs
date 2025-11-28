import info from './info.json' with { type: 'json' }
import { setEndpoints } from './src/endpoints.mjs'

/**
 * Debug Info Shell 模块。
 */
export default {
	info,
	/**
	 * 加载 shell。
	 * @param {Object} root0 - 参数对象。
	 * @param {Object} root0.router - Express 路由器。
	 */
	Load: ({ router }) => { setEndpoints(router) },
	/**
	 * 卸载 shell。
	 */
	Unload: () => { },
}
