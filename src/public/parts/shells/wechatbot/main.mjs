import { runBot, pauseBot } from './src/bot.mjs'
import { setEndpoints } from './src/endpoints.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * @param {string} user 用户名。
 * @param {string} action 动作名称。
 * @param {object} params 动作调用参数。
 * @returns {Promise<any>} 返回值。
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
	 *
	 * @param {any} root0 解构参数对象。
	 * @param {any} root0.router Express 路由实例。
 * @returns {any} 操作执行结果。
	 */
	Load: ({ router }) => {
		setEndpoints(router)
	},
	/**
	 *
 * @returns {Promise<any>} 无返回值。
	 */
	Unload: async () => { },
	interfaces: {
		web: {},
		invokes: {
			/**
			 *
			 * @param {any} user 用户名。
			 * @param {any} args 参数数组。
 * @returns {Promise<any>} 无返回值。
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
			 *
			 * @param {any} user 用户名。
			 * @param {any} data IPC 调用载荷。
 * @returns {any} 操作执行结果。
			 */
			IPCInvokeHandler: (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			}
		},
		jobs: {
			/**
			 *
			 * @param {any} user 用户名。
			 * @param {any} botname 机器人名称。
 * @returns {Promise<any>} 操作执行结果。
			 */
			PauseJob: async (user, botname) => {
				await pauseBot(user, botname)
			},
			/**
			 *
			 * @param {any} user 用户名。
			 * @param {any} botname 机器人名称。
 * @returns {Promise<any>} 无返回值。
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
