import info from './info.json' with { type: 'json' };
import { setEndpoints } from './src/main.mjs'

/**
 * 处理传入的快速新建动作请求。
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

/** @type {import('../../../decl/shellAPI.ts').ShellAPI_t} */
export default {
	info,

	/**
	 * 加载快速新建Shell并设置API端点。
	 * @param {object} root0 - 参数对象。
	 * @param {object} root0.router - Express的路由实例。
	 * @returns {Promise<void>}
	 */
	Load: async ({ router }) => {
		setEndpoints(router)
	},

	interfaces: {
		invokes: {
			/**
			 * 处理命令行参数以执行快速新建操作。
			 * @param {string} user - 用户名。
			 * @param {Array<string>} args - 命令行参数数组。
			 * @returns {Promise<void>}
			 */
			ArgumentsHandler: async (user, args) => {
				const [action, templateName, partName, jsonData] = args
				const params = {
					templateName,
					partName,
					jsonData: jsonData ? JSON.parse(jsonData) : {}
				}
				const result = await handleAction(user, action, params)
				if (result !== undefined)
					console.log(result)
			},
			/**
			 * 处理IPC调用以执行快速新建操作。
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
