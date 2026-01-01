import info from './info.json' with { type: 'json' }
import { setEndpoints } from './src/endpoints.mjs'

/**
 * Subfounts Shell - 点对点分机管理
 */
export default {
	info,
	/**
	 * 加载 subfounts shell 并设置 API 端点。
	 * @param {object} root0 - 参数对象。
	 * @param {object} root0.router - Express router 实例。
	 */
	Load({ router }) {
		setEndpoints(router)
	},
	interfaces: {
		web: {},
	},
}
