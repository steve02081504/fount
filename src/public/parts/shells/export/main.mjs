import fs from 'node:fs/promises'

import info from './info.json' with { type: 'json' }
import { setEndpoints } from './src/endpoints.mjs'

/**
 * 处理传入的导出动作请求。
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
 * 导出组件Shell
 */
export default {
	info,
	/**
	 * 加载导出组件Shell并设置API端点。
	 * @param {object} root0 - 参数对象。
	 * @param {object} root0.router - Express的路由实例。
	 */
	Load: ({ router }) => {
		setEndpoints(router)
	},
	interfaces: {
		web: {},
		invokes: {
			/**
			 * 处理命令行参数以执行导出操作。
			 * @param {string} user - 用户名。
			 * @param {Array<string>} args - 命令行参数数组。
			 * @returns {Promise<void>}
			 */
			ArgumentsHandler: async (user, args) => {
				const [partpath, withDataStr, outputPath] = args
				const withData = withDataStr === 'true'
				const params = { partpath, withData }

				const { buffer, format } = await handleAction(user, 'default', params)
				const partName = partpath.split('/').pop()
				const finalOutputPath = outputPath || `${partName}${withData ? '_with_data' : ''}.${format}`
				await fs.writeFile(finalOutputPath, buffer)
				console.log(`Part '${partpath}' exported to ${finalOutputPath}`)
			},
			/**
			 * 处理IPC调用以执行导出操作。
			 * @param {string} user - 用户名。
			 * @param {object} data - 从IPC接收的数据对象。
			 * @returns {Promise<any>} - 动作执行结果。
			 */
			IPCInvokeHandler: async (user, data) => {
				return handleAction(user, 'default', data)
			}
		}
	}
}
