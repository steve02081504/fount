import { setEndpoints } from './src/endpoints.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 处理动作
 * @param {string} user - 用户名
 * @param {string} action - 动作名称
 * @param {object} params - 动作参数
 * @returns {Promise<string>}
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
	 * 加载 channels shell 并设置 API 端点
	 * @param {object} options - 选项
	 * @param {object} options.router - Express 路由实例
	 */
	Load: async ({ router }) => {
		setEndpoints(router)
	},
	/**
	 * 卸载 channels shell
	 * @returns {Promise<void>}
	 */
	Unload: async () => { },
	interfaces: {
		web: {},
		/**
		 * 调用接口的定义
		 */
		invokes: {
			/**
			 * 处理命令行参数以执行频道操作
			 * @param {string} user - 用户名
			 * @param {Array<string>} args - 参数数组
			 * @returns {Promise<void>}
			 */
			ArgumentsHandler: async (user, args) => {
				const [action, ...restArgs] = args
				const params = {}

				switch (action) {
					case 'create':
						params.name = restArgs[0]
						params.description = restArgs[1]
						params.type = restArgs[2]
						break
					case 'subscribe':
					case 'unsubscribe':
					case 'delete':
					case 'info':
						params.channelId = restArgs[0]
						break
				}

				const result = await handleAction(user, action, params)
				if (result != null)
					console.log(result)
			},
			/**
			 * 处理 IPC 调用以执行频道操作
			 * @param {string} user - 用户名
			 * @param {any} data - IPC 调用载荷
			 * @returns {Promise<string>}
			 */
			IPCInvokeHandler: (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			}
		}
	}
}
