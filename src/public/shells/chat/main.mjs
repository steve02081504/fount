import info from './info.json' with { type: 'json' };
import { hosturl } from '../../../server/server.mjs'

import { setEndpoints } from './src/endpoints.mjs'
import { cleanFilesInterval } from './src/files.mjs'

let loading_count = 0

/**
 * 处理传入的聊天动作请求。
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
	 * 加载聊天Shell，设置API端点并增加加载计数。
	 * @param {object} root0 - 参数对象。
	 * @param {object} root0.router - Express的路由实例。
	 */
	Load: ({ router }) => {
		loading_count++
		setEndpoints(router)
	},
	/**
	 * 卸载聊天Shell，减少加载计数并在必要时清理定时器。
	 */
	Unload: () => {
		loading_count--
		if (!loading_count)
			clearInterval(cleanFilesInterval)
	},

	interfaces: {
		invokes: {
			/**
			 * 处理命令行参数以执行各种聊天操作。
			 * @param {string} user - 用户名。
			 * @param {Array<string>} args - 命令行参数数组。
			 * @returns {Promise<void>}
			 */
			ArgumentsHandler: async (user, args) => {
				const command = args[0]
				let params = {}
				let result

				switch (command) {
					case 'start':
						params = { charName: args[1] }
						result = await handleAction(user, command, params)
						console.log(`Started new chat at: ${hosturl}/shells/chat/#${result}`)
						break
					case 'asjson':
						params = { chatInfo: JSON.parse(args[1]) }
						result = await handleAction(user, command, params)
						console.log(`Loaded chat from JSON: ${args[1]}`)
						break
					case 'load':
						params = { chatId: args[1] }
						result = await handleAction(user, command, params)
						console.log(`Continue chat at: ${hosturl}/shells/chat/#${result}`)
						break
					case 'tail':
						params = { chatId: args[1], n: parseInt(args[2] || '5', 10) }
						result = await handleAction(user, command, params)
						result.forEach(log => {
							console.log(`[${new Date(log.time_stamp).toLocaleString()}] ${log.name}: ${log.content}`)
						})
						break
					case 'send':
						params = { chatId: args[1], message: { content: args[2] } }
						await handleAction(user, command, params)
						console.log(`Message sent to chat ${args[1]}`)
						break
					case 'edit-message':
						params = { chatId: args[1], index: parseInt(args[2], 10), newContent: { content: args.slice(3).join(' ') } }
						await handleAction(user, command, params)
						console.log(`Message at index ${args[2]} in chat ${args[1]} edited.`)
						break
					default: {
						const [chatId, ...rest] = args.slice(1)
						const paramMap = {
							'remove-char': { charName: rest[0] },
							'set-persona': { personaName: rest[0] },
							'set-world': { worldName: rest[0] },
							'set-char-frequency': { charName: rest[0], frequency: parseFloat(rest[1]) },
							'trigger-reply': { charName: rest[0] },
							'delete-message': { index: parseInt(rest[0], 10) },
							'modify-timeline': { delta: parseInt(rest[0], 10) }
						}
						params = { chatId, ...paramMap[command] }
						result = await handleAction(user, command, params)
						if (result !== undefined) console.log(result)
						break
					}
				}
			},
			/**
			 * 处理IPC调用以执行聊天操作。
			 * @param {string} user - 用户名。
			 * @param {object} data - 从IPC接收的数据对象。
			 * @returns {Promise<any>} - 动作执行结果。
			 */
			IPCInvokeHandler: async (user, data) => {
				const { command, ...params } = data
				return handleAction(user, command, params)
			}
		}
	}
}
