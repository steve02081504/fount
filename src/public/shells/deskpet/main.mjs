import { setEndpoints } from './src/endpoints.mjs'
import info from './info.json' with { type: 'json' }

/**
 * 处理传入的桌面宠物动作请求。
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
 * 桌面宠物Shell
 */
export default {
	info,
	/**
	 * 加载桌面宠物Shell并设置API端点。
	 * @param {object} root0 - 参数对象。
	 * @param {object} root0.router - Express的路由实例。
	 * @returns {Promise<void>}
	 */
	Load: async ({ router }) => {
		setEndpoints(router)
	},
	/**
	 * 卸载桌面宠物Shell。
	 * @returns {Promise<void>}
	 */
	Unload: async () => { },

	interfaces: {
		invokes: {
			/**
			 * 处理命令行参数以执行桌面宠物操作。
			 * @param {string} user - 用户名。
			 * @param {Array<string>} args - 命令行参数数组。
			 * @returns {Promise<void>}
			 */
			ArgumentsHandler: async (user, args) => {
				const [action, charname] = args
				const params = {
					charname
				}
				const result = await handleAction(user, action, params)
				if (result !== undefined)
					console.log(result)
			},
			/**
			 * 处理IPC调用以执行桌面宠物操作。
			 * @param {string} user - 用户名。
			 * @param {object} data - 从IPC接收的数据对象。
			 * @returns {Promise<any>} - 动作执行结果。
			 */
			IPCInvokeHandler: async (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			}
		},
		jobs: {
			/**
			 * 重新启动桌面宠物任务。
			 * @param {string} user - 用户名。
			 * @param {string} charname - 角色名称。
			 * @returns {Promise<void>}
			 */
			ReStartJob: async (user, charname) => {
				const { runPet } = await import('./src/pet_runner.mjs')
				await runPet(user, charname)
			}
		}
	}
}
