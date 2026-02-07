import info from './info.json' with { type: 'json' }
import { setEndpoints } from './src/endpoints.mjs'

/**
 * IDE 集成 Shell 主入口。
 */
export default {
	info,
	/**
	 * 加载 Shell。
	 * @param {object} params - 加载参数。
	 * @param {object} params.router - Express 路由器。
	 */
	Load: ({ router }) => {
		setEndpoints(router)
	},
	/**
	 * 卸载 Shell。
	 */
	Unload: () => { },
	interfaces: {
		web: {},
	}
}
