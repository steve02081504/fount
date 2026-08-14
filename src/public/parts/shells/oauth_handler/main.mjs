import { setEndpoints } from './src/endpoints.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * OAuth 回调与登录编排 shell。
 */
export default {
	info,
	/**
	 * 加载 oauth_handler 并挂上 REST。
	 * @param {{ router: import('npm:express').Router }} args - 加载参数。
	 * @returns {void}
	 */
	Load: ({ router }) => {
		setEndpoints(router)
	},
	interfaces: {
		web: {},
	},
}
