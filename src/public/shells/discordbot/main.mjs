import info from './info.json' assert { type: 'json' };
import { runBot } from './src/bot.mjs'
import { setEndpoints } from './src/endpoints.mjs'

/**
 * 处理传入的Discord机器人动作请求。
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
	 * 加载Discord机器人Shell并设置API端点。
	 * @param {object} root0 - 参数对象。
	 * @param {object} root0.router - Express的路由实例。
	 * @returns {Promise<void>}
	 */
	Load: async ({ router }) => {
		setEndpoints(router)
	},
	/**
	 * 卸载Discord机器人Shell。
	 * @returns {Promise<void>}
	 */
	Unload: async () => { },

	interfaces: {
		invokes: {
			/**
			 * 处理命令行参数以执行Discord机器人操作。
			 * @param {string} user - 用户名。
			 * @param {Array<string>} args - 命令行参数数组。
			 * @returns {Promise<void>}
			 */
			ArgumentsHandler: async (user, args) => {
				const [action, name, jsonData] = args
				const params = {
					botname: name,
					charname: name,
					configData: jsonData ? JSON.parse(jsonData) : undefined
				}
				const result = await handleAction(user, action, params)
				if (result !== undefined)
					console.log(result)
			},
			/**
			 * 处理IPC调用以执行Discord机器人操作。
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
			 * 重新启动Discord机器人任务。
			 * @param {string} user - 用户名。
			 * @param {string} botname - 机器人名称。
			 * @returns {Promise<void>}
			 */
			ReStartJob: async (user, botname) => {
				let sleep_time = 0
				while (true) try {
					await runBot(user, botname)
					break
				} catch (error) {
					console.error(error)
					await new Promise(resolve => setTimeout(resolve, sleep_time))
					sleep_time += 1000
				}
			}
		}
	}
}
