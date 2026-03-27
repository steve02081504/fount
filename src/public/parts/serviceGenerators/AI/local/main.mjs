import { configTemplate } from './src/configTemplate.mjs'
import { GetSource } from './src/getSource.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 执行指定动作。
 * @param {string} user - 用户名。
 * @param {string} action - 动作名称。
 * @param {object} params - 动作参数。
 * @returns {Promise<any>} 动作执行结果。
 */
async function handleAction(user, action, params) {
	const { actions } = await import('./src/actions.mjs')
	if (!actions[action])
		throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)
	return actions[action]({ user, ...params })
}

/**
 * Local AI 来源生成器模块定义。
 * @type {import('../../../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * 获取此 AI 源的配置模板。
			 * @returns {Promise<object>} 配置模板。
			 */
			GetConfigTemplate: async () => configTemplate,
			GetSource,
		},
		invokes: {
			/**
			 * 处理命令行参数。
			 *
			 * 支持的命令：
			 *   install <uri|path> [source-name]
			 *     从 URL、HuggingFace URI 或本地文件路径安装模型并创建 AI 源。
			 *     uri 支持：
			 *       https://example.com/model.gguf
			 *       hf:owner/model:Q4_K_M
			 *       hf:owner/model/filename.gguf
			 *       hf.co/owner/model:Q4_K_M
			 *       ./models/my-model.gguf（本地文件路径）
			 *
			 *   create-from-path <path> [source-name]
			 *     install 的别名，等价于 install <path>。
			 *
			 * @param {string} user - 用户名。
			 * @param {Array<string>} args - 命令行参数数组。
			 * @returns {Promise<void>}
			 */
			ArgumentsHandler: async (user, args, context = {}) => {
				const action = args[0]
				let params = {}

				if (action === 'install')
					params = { uri: args[1], sourceName: args[2], cwd: context.cwd }
				else if (action === 'create-from-path')
					params = { modelPath: args[1], sourceName: args[2], cwd: context.cwd }

				const result = await handleAction(user, action, params)
				console.log(result)
			},

			/**
			 * 处理 IPC 调用。
			 * @param {string} user - 用户名。
			 * @param {object} data - IPC 数据对象，需含 action 字段。
			 * @returns {Promise<any>} 动作执行结果。
			 */
			IPCInvokeHandler: async (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			},
		}
	}
}
