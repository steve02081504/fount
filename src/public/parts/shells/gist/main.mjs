import { setEndpoints } from './src/endpoints.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * gist shell 主入口：集中式 Markdown 文档存储与预览站。
 */
export default {
	/**
	 * Shell 的信息。
	 */
	info,
	/**
	 * 加载 gist shell 并设置 API 端点。
	 * @param {object} root0 - 参数对象。
	 * @param {object} root0.router - Express 的路由实例。
	 */
	Load: ({ router }) => {
		setEndpoints(router)
	},
	interfaces: {
		web: {},
	},
}
