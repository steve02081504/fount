import info from './info.json' with { type: 'json' }
import { actions } from './src/actions.mjs'
import { runBot } from './src/bot.mjs'
import { setEndpoints } from './src/endpoints.mjs'

/** @typedef {import('../../../decl/basedefs.ts').info_t} info_t */

/**
 * telegrambot 的入口点。
 */

/**
 * 处理传入的Telegram机器人动作请求。
 * @param {string} user - 用户名。
 * @param {string} action - 要执行的动作名称。
 * @param {object} params - 动作所需的参数。
 * @returns {Promise<any>} - 返回动作执行的结果。
 */
async function handleAction(user, action, params) {
	if (!actions[action])
		throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)

	return actions[action]({ user, ...params })
}

/**
 * @type {import('../../../decl/shell.ts').shell_t}
 */
export default {
	/**
	 * Shell 的信息。
	 * @type {info_t}
	 */
	info,
	/**
	 * 加载Telegram机器人Shell并设置API端点。
	 * @param {object} options - 选项。
	 * @param {object} options.router - Express的路由实例。
	 */
	Load: async ({ router }) => {
		// 设置此 shell 的 API 端点
		setEndpoints(router)
	},
	/**
	 * 卸载Telegram机器人Shell。
	 */
	Unload: async () => {
		// 在卸载 shell 时可以进行一些清理工作，如果需要的话
		// 例如，确保所有bot实例都已停止（尽管 on_shutdown 应该处理这个）
	},
	/**
	 * Shell的接口定义。
	 */
	interfaces: {
		web: {},
		/**
		 * 调用接口的定义。
		 */
		invokes: {
			/**
			 * 处理命令行参数以执行Telegram机器人操作。
			 * @param {string} user - 用户名。
			 * @param {Array<string>} args - 命令行参数数组。
			 */
			// 处理通过 fount 命令行/脚本调用的情况，例如 'run shells <user> telegrambot <botname> start'
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
			 * 处理IPC调用以执行Telegram机器人操作。
			 * @param {string} user - 用户名。
			 * @param {object} data - 从IPC接收的数据对象。
			 * @returns {Promise<any>} - 动作执行结果。
			 */
			IPCInvokeHandler: async (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			}
		},
		/**
		 * 任务接口的定义。
		 */
		jobs: {
			/**
			 * 重新启动Telegram机器人任务。
			 * @param {string} user - 用户名。
			 * @param {string} botname - 机器人名称。
			 */
			// 当 fount 启动时，如果之前有正在运行的bot，则重新启动它们
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
