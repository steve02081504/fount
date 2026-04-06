import { runBot, pauseBot } from './src/bot.mjs'
import { setEndpoints } from './src/endpoints.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 处理动作。
 * @param {string} user 用户名。
 * @param {string} action 动作名称。
 * @param {object} params 动作调用参数。
 * @returns {Promise<string>} 动作执行结果。
 */
async function handleAction(user, action, params) {
	const { actions } = await import('./src/actions.mjs')
	if (!actions[action])
		throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)

	return actions[action]({ user, ...params })
}

/** @type {import('../../../../../src/decl/shellAPI.ts').shellAPI_t} */
export default {
	info,
	/**
	 * 加载 wechatbot shell 并设置 API 端点。
	 * @param {object} options - 选项。
	 * @param {object} options.router - Express 路由实例。
	 */
	Load: async ({ router }) => {
		setEndpoints(router)
	},
	/**
	 * 卸载 wechatbot shell。
	 * @returns {Promise<void>}
	 */
	Unload: async () => { },
	interfaces: {
		web: {},
		/**
		 * 调用接口的定义。
		 */
		invokes: {
			/**
			 * 处理命令行参数以执行 wechatbot 操作。
			 * @param {string} user 用户名。
			 * @param {Array<string>} args 参数数组。
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
			 * 处理 IPC 调用以执行 wechatbot 操作。
			 * @param {string} user 用户名。
			 * @param {any} data IPC 调用载荷。
			 * @returns {Promise<string>} 操作执行结果。
			 */
			IPCInvokeHandler: (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			}
		},
		jobs: {
			/**
			 * 暂停机器人。
			 * @param {string} user 用户名。
			 * @param {string} botname 机器人名称。
			 * @returns {Promise<void>}
			 */
			PauseJob: async (user, botname) => {
				await pauseBot(user, botname)
			},
			/**
			 * 重新启动机器人。
			 * 当 fount 启动时，如果之前有正在运行的bot，则重新启动它们。
			 * @param {string} user 用户名。
			 * @param {string} botname 机器人名称。
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
			},
		}
	}
}
