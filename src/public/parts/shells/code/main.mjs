import { setEndpoints } from './src/endpoints.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 部件信息类型别名。
 * @typedef {import('../../../../decl/basedefs.ts').info_t} info_t
 */

/**
 * code shell 入口：AI 编码会话（opencode 风格 web 界面）。
 */
export default {
	/**
	 * Shell 的信息。
	 * @type {info_t}
	 */
	info,
	/**
	 * 加载 code shell 并设置 API 端点。
	 * @param {object} options - 选项。
	 * @param {object} options.router - Express 的路由实例。
	 */
	Load: ({ router }) => {
		setEndpoints(router)
	},
	interfaces: {
		web: {},
	},
}
