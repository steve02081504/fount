import info from './info.json' with { type: 'json' }
import { setEndpoints } from './src/endpoints.mjs'

/**
 * 解析命令行参数，支持更直观的命令语法。
 * @param {Array<string>} args - 命令行参数数组。
 * @returns {{action: string, params: object}} - 解析后的动作和参数。
 */
function parseArgs(args) {
	if (!args.length) 
		throw new Error('No action specified. Available actions: list, get, create, set, delete, set-default')
	

	const action = args[0]
	const params = {}

	switch (action) {
		case 'list': {
			// list [type]
			params.type = args[1] || 'AI'
			break
		}
		case 'get': {
			// get <name> [type]
			if (!args[1]) throw new Error('Source name is required for get action.')
			params.sourceName = args[1]
			params.type = args[2] || 'AI'
			break
		}
		case 'create': {
			// create <name> [type] [generator]
			if (!args[1]) throw new Error('Source name is required for create action.')
			params.sourceName = args[1]
			params.type = args[2] || 'AI'
			params.generator = args[3]
			break
		}
		case 'set': {
			// set <name> [type] [--config <json>]
			if (!args[1]) throw new Error('Source name is required for set action.')
			params.sourceName = args[1]
			params.type = args[2] || 'AI'
			// 查找 --config 参数
			const configIndex = args.indexOf('--config')
			if (configIndex !== -1 && args[configIndex + 1]) 
				try {
					params.config = JSON.parse(args[configIndex + 1])
				}
				catch (e) {
					throw new Error(`Invalid JSON in --config: ${e.message}`)
				}
			
			break
		}
		case 'delete': {
			// delete <name> [type]
			if (!args[1]) throw new Error('Source name is required for delete action.')
			params.sourceName = args[1]
			params.type = args[2] || 'AI'
			break
		}
		case 'set-default': {
			// set-default <name> [type]
			if (!args[1]) throw new Error('Source name is required for set-default action.')
			params.sourceName = args[1]
			params.type = args[2] || 'AI'
			break
		}
		default:
			throw new Error(`Unknown action: ${action}. Available actions: list, get, create, set, delete, set-default`)
	}

	return { action, params }
}

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
 * @type {import('../../../../decl/shell.ts').shell_t}
 */
export default {
	info,
	/**
	 * 加载Shell，设置路由端点。
	 * @param {object} root0 - 参数。
	 * @param {object} root0.router - Express的路由实例。
	 */
	Load: ({ router }) => {
		setEndpoints(router)
	},
	interfaces: {
		web: {},
		invokes: {
			/**
			 * 处理命令行参数，支持更直观的命令语法。
			 * @param {string} user - 用户名。
			 * @param {Array<string>} args - 命令行参数数组。
			 * @returns {Promise<void>}
			 */
			ArgumentsHandler: async (user, args) => {
				const { action, params } = parseArgs(args)
				const result = await handleAction(user, action, params)
				if (result !== undefined)
					console.log(result)
			},
			/**
			 * 处理IPC调用。
			 * @param {string} user - 用户名。
			 * @param {object} data - 从IPC接收的数据对象，包含要执行的动作及其参数。
			 * @returns {Promise<any>} - 动作执行结果。
			 */
			IPCInvokeHandler: async (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			}
		}
	}
}
