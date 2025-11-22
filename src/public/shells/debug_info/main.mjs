import { setEndpoints } from './src/endpoints.mjs'

/**
 * Debug Info Shell 模块。
 */
export default {
	info: {
		'': {
			name: 'debug info',
			description: 'System diagnostics and version checking tool.',
			version: '0.0.0',
			author: 'steve02081504',
		},
	},
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
