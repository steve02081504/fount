import { setEndpoints } from './src/endpoints.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 部件信息类型别名。
 * @typedef {import('../../../../decl/basedefs.ts').info_t} info_t
 */

/**
 * 手机 Agent Shell 的入口点。
 */
export default {
	/**
	 * Shell 信息。
	 * @type {info_t}
	 */
	info,
	/**
	 * 加载手机 Shell 并设置 API 端点。
	 * @param {object} options - 选项。
	 * @param {object} options.router - Express 路由实例。
	 */
	Load: ({ router }) => {
		setEndpoints(router)
	},
	/**
	 * Shell 的接口定义。
	 */
	interfaces: {
		/**
		 * 供服务端 IPC 触发的入口：向指定设备下发一次命令。
		 * @param {string} username - 用户名。
		 * @param {object} data - IPC 负载。
		 * @returns {Promise<object>} 命令结果。
		 */
		invokes: {
			/**
			 * 在指定用户的设备上执行一次命令。
			 * @param {string} username - 用户名。
			 * @param {object} data - IPC 负载。
			 * @returns {Promise<object>} 命令结果。
			 */
			IPCInvokeHandler: async (username, data) => {
				const { execOnDevice } = await import('./src/api.mjs')
				return execOnDevice(username, data)
			}
		}
	}
}
