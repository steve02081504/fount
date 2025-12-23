import info from './info.json' with { type: 'json' }
import { setEndpoints } from './src/endpoints.mjs'

/** @typedef {import('../../../../decl/basedefs.ts').info_t} info_t */

/**
 * 用户设置 shell 的入口点。
 */

/**
 * 处理动作。
 * @param {string} user - 用户。
 * @param {string} action - 动作。
 * @param {object} params - 参数。
 * @returns {Promise<any>} - 动作结果。
 */
async function handleAction(user, action, params) {
	const { actions } = await import('./src/actions.mjs')
	if (!actions[action])
		throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)

	return actions[action]({ user, ...params })
}

/**
 * 用户设置 shell。
 */
export default {
	/**
	 * Shell 的信息。
	 * @type {info_t}
	 */
	info,
	/**
	 * 加载 shell。
	 * @param {object} options - 选项。
	 * @param {object} options.router - 路由。
	 */
	Load: async ({ router }) => {
		setEndpoints(router)
	},
	/**
	 * 卸载 shell。
	 */
	Unload: async () => { },
	/**
	 * Shell 的接口。
	 */
	interfaces: {
		web: {},
		/**
		 * 调用接口。
		 */
		invokes: {
			/**
			 * 处理命令行参数。
			 * @param {string} user - 用户。
			 * @param {Array<string>} args - 参数。
			 */
			ArgumentsHandler: async (user, args) => {
				const action = args[0]
				const params = {}
				switch (action) {
					case 'change-password':
						params.currentPassword = args[1]
						params.newPassword = args[2]
						break
					case 'revoke-device':
						params.tokenJti = args[1]
						params.password = args[2]
						break
					case 'rename-user':
						params.newUsername = args[1]
						params.password = args[2]
						break
					case 'delete-account':
						params.password = args[1]
						break
					case 'create-apikey':
						params.description = args[1]
						break
					case 'revoke-apikey':
						params.jti = args[1]
						break
				}
				const result = await handleAction(user, action, params)
				if (result !== undefined)
					console.log(result)
			},
			/**
			 * 处理 IPC 调用。
			 * @param {string} user - 用户。
			 * @param {object} data - 数据。
			 * @returns {Promise<any>} - 调用结果。
			 */
			IPCInvokeHandler: async (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			}
		}
	}
}
