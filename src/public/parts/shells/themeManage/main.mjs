import info from './info.json' with { type: 'json' }
import { setEndpoints } from './src/endpoints.mjs'

/** @typedef {import('../../../../decl/basedefs.ts').info_t} info_t */

/**
 * 主题管理 shell 的入口点。
 */
export default {
	/**
	 * Shell 的信息。
	 * @type {info_t}
	 */
	info,
	/**
	 * 加载主题管理Shell。
	 * @param {object} options - 选项。
	 * @param {object} options.router - Express的路由实例。
	 */
	Load: async ({ router }) => { setEndpoints(router) },
	/**
	 * 卸载主题管理Shell。
	 */
	Unload: async () => { },
	interfaces: {
		web: {},
	}
}
