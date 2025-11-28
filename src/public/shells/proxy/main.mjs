import info from './info.json' with { type: 'json' };
import { actions } from './src/actions.mjs'
import { setEndpoints } from './src/endpoints.mjs'

/**
 * 处理传入的代理动作请求。
 * @param {string} user - 用户名。
 * @param {object} params - 动作所需的参数。
 * @returns {Promise<any>} - 返回动作执行的结果。
 */
async function handleAction(user, params) {
	return actions.default({ user, ...params })
}

/**
 * 代理Shell
 */
export default {
	info,
	/**
	 * 加载代理Shell并设置API端点。
	 * @param {object} options - 选项。
	 * @param {object} options.router - Express的路由实例。
	 */
	Load: ({ router }) => {
		setEndpoints(router)
	},
	interfaces: {
		invokes: {
			/**
			 * 处理命令行参数以显示API端点和二维码。
			 * @param {string} user - 用户名。
			 * @param {Array<string>} args - 命令行参数（未使用）。
			 */
			ArgumentsHandler: async (user, args) => {
				const url = await handleAction(user, {})
				const webUI = new URL('/shells/proxy', url).href
				console.log(`Your OpenAI-compatible API endpoint is: ${url}`)
				console.log(`Please go to ${webUI} to generate an API key.`)
				const qrcode = await import('npm:qrcode-terminal')
				qrcode.generate(webUI, { small: true }, console.noBreadcrumb.log)
				console.log(`You can use it with any OpenAI-compatible client, for example, to list models, run: curl ${url}/v1/models -H "Authorization: Bearer <your_fount_apikey>"`)
			},
			/**
			 * 处理IPC调用以获取API端点URL。
			 * @param {string} user - 用户名。
			 * @param {object} args - IPC调用参数（未使用）。
			 * @returns {Promise<any>} - API端点URL。
			 */
			IPCInvokeHandler: async (user, args) => {
				return handleAction(user, args)
			}
		}
	}
}
