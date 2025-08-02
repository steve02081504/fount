import { runBot } from './src/server/bot.mjs'
import { setEndpoints } from './src/server/endpoints.mjs'
import { actions } from './actions.mjs'

async function handleAction(user, action, params) {
	if (!actions[action])
		throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)

	return actions[action]({ user, ...params })
}

export default {
	info: {
		'': { // 默认语言 (通常是 en-US 或根据您的主要用户群体)
			name: 'telegrambot',
			avatar: 'https://api.iconify.design/line-md/telegram.svg', // 使用SVG图标
			description: 'Run your char as a Telegram bot.',
			description_markdown: 'Integrate your fount character with Telegram to interact with users on the platform.',
			version: '1.0.0',
			author: 'steve02081504', // 您的名字
			home_page: '', // 项目主页或相关链接
			tags: ['telegram', 'bot', 'chat', 'integration']
		},
		'zh-CN': {
			name: 'Telegram机器人',
			description: '将您的角色作为Telegram机器人运行。',
			description_markdown: '将您的fount角色与Telegram集成，以便在该平台上与用户互动。',
			tags: ['Telegram', '机器人', '聊天', '集成']
		}
		// 可以添加更多语言的本地化信息
	},
	Load: async ({ router }) => {
		// 设置此 shell 的 API 端点
		setEndpoints(router)
	},
	Unload: async () => {
		// 在卸载 shell 时可以进行一些清理工作，如果需要的话
		// 例如，确保所有机器人实例都已停止（尽管 on_shutdown 应该处理这个）
	},

	interfaces: {
		invokes: {
			// 处理通过 fount 命令行/脚本调用的情况，例如 'run shells <user> telegrambot <botname> start'
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
			IPCInvokeHandler: async (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			}
		},
		jobs: {
			// 当 fount 启动时，如果之前有正在运行的机器人，则重新启动它们
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
			}
		}
	}
}
