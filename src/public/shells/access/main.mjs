import info from './info.json' with { type: 'json' };
/**
 * 处理传入的动作请求。
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
 * 在其他设备访问Shell
 */
export default {
	info,
	/**
	 * 加载Shell。
	 * @param {object} root0 - 参数。
	 * @param {object} root0.router - 路由。
	 * @returns {Promise<void>}
	 */
	Load: async ({ router }) => { },
	/**
	 * 卸载Shell。
	 * @returns {Promise<void>}
	 */
	Unload: async () => { },
	interfaces: {
		invokes: {
			/**
			 * 处理命令行参数，显示用于在其他设备上访问的URL和二维码。
			 * @param {string} user - 用户名。
			 * @param {Array<string>} args - 命令行参数（未使用）。
			 * @returns {Promise<void>}
			 */
			ArgumentsHandler: async (user, args) => {
				const url = await handleAction(user, 'default', {})
				console.log(`Access fount on other devices in the same network via: ${url}`)
				const qrcode = await import('npm:qrcode-terminal')
				qrcode.generate(url, { small: true }, console.noBreadcrumb.log)
			},
			/**
			 * 处理IPC调用，返回用于在其他设备上访问的URL。
			 * @param {string} user - 用户名。
			 * @param {object} args - IPC调用参数（未使用）。
			 * @returns {Promise<any>} - 动作结果，即访问URL。
			 */
			IPCInvokeHandler: async (user, args) => {
				return handleAction(user, 'default', args)
			}
		}
	}
}
