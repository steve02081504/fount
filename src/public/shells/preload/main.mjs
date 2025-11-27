import info from './info.json' assert { type: 'json' };
/**
 * 处理传入的预加载动作请求。
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
 * 预加载Shell
 */
export default {
	info,
	/**
	 * 加载预加载Shell。
	 * @param {object} root0 - 参数对象。
	 * @param {object} root0.router - Express的路由实例。
	 */
	Load: ({ router }) => { },
	/**
	 * 卸载预加载Shell。
	 * @param {object} root0 - 参数对象。
	 * @param {object} root0.router - Express的路由实例。
	 */
	Unload: ({ router }) => { },

	interfaces: {
		invokes: {
			/**
			 * 处理命令行参数以执行预加载操作。
			 * @param {string} user - 用户名。
			 * @param {Array<string>} args - 命令行参数数组。
			 * @returns {Promise<void>}
			 */
			ArgumentsHandler: async (user, args) => {
				await handleAction(user, 'default', { parttype: args[0], partname: args[1] })
			},
			/**
			 * 处理IPC调用以执行预加载操作。
			 * @param {string} user - 用户名。
			 * @param {object} data - 从IPC接收的数据对象。
			 * @returns {Promise<void>}
			 */
			IPCInvokeHandler: async (user, data) => {
				await handleAction(user, 'default', data)
			}
		}
	}
}
