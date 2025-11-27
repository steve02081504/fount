import info from './info.json' assert { type: 'json' };
import { setEndpoints } from './src/endpoints.mjs'

/**
 * 处理传入的安装动作请求。
 * @param {string} user - 用户名。
 * @param {string} action - 要执行的动作名称。
 * @param {object} params - 动作所需的参数。
 * @returns {Promise<any>} - 返回动作执行的结果。
 */
async function handleAction(user, action, params) {
	const { actions } = await import('./src/actions.mjs')
	if (!actions[action])
		throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)

	return actions[action]({ user, ...params })
}

/**
 * @type {import('../../../decl/shell.ts').shell_t}
 */
export default {
	info,
	/**
	 * 加载安装Shell并设置API端点。
	 * @param {object} root0 - 参数对象。
	 * @param {object} root0.router - Express的路由实例。
	 */
	Load: ({ router }) => {
		setEndpoints(router)
	},

	interfaces: {
		invokes: {
			/**
			 * 处理命令行参数以执行安装或卸载操作。
			 * @param {string} user - 用户名。
			 * @param {Array<string>} args - 命令行参数数组。
			 * @returns {Promise<void>}
			 */
			ArgumentsHandler: async (user, args) => {
				const action = args[0]
				let params = {}
				if (action === 'install')
					params = { input: args[1] }
				else if (action === 'uninstall')
					params = { partType: args[1], partName: args[2] }

				const result = await handleAction(user, action, params)
				console.log(result)
			},
			/**
			 * 处理IPC调用以执行安装或卸载操作。
			 * @param {string} user - 用户名。
			 * @param {object} data - 从IPC接收的数据对象。
			 * @returns {Promise<any>} - 动作执行结果。
			 */
			IPCInvokeHandler: async (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			}
		}
	}
}
