import { runBot, stopBot } from './src/server/bot.mjs'
import { setEndpoints } from './src/server/endpoints.mjs'

export default {
	info: {
		'': { // 默认语言 (通常是 en-US 或根据您的主要用户群体)
			name: 'telegrambot',
			avatar: 'https://api.iconify.design/line-md/telegram.svg', // 使用SVG图标
			description: 'Run your char as a Telegram bot.',
			description_markdown: 'Integrate your Fount character with Telegram to interact with users on the platform.',
			version: '1.0.0',
			author: 'steve02081504', // 您的名字
			homepage: '', // 项目主页或相关链接
			tags: ['telegram', 'bot', 'chat', 'integration']
		},
		'zh-CN': {
			name: 'Telegram机器人',
			description: '将您的角色作为Telegram机器人运行。',
			description_markdown: '将您的Fount角色与Telegram集成，以便在该平台上与用户互动。',
			tags: ['Telegram', '机器人', '聊天', '集成']
		}
		// 可以添加更多语言的本地化信息
	},
	Load: async ({router}) => {
		// 设置此 shell 的 API 端点
		setEndpoints(router)
	},
	Unload: async () => {
		// 在卸载 shell 时可以进行一些清理工作，如果需要的话
		// 例如，确保所有机器人实例都已停止（尽管 on_shutdown 应该处理这个）
	},

	interfaces: {
		invokes: {
			// 处理通过 Fount 命令行/脚本调用的情况，例如 'runshell <user> telegrambot <botname> start'
			ArgumentsHandler: async (user, args) => {
				const botname = args[0]
				const action = args[1] ?? 'start' // 默认为 'start'
				if (!botname)
					throw new Error('Bot name is required for telegrambot shell.')

				if (action === 'stop')
					await stopBot(user, botname)
				else if (action === 'start')
					await runBot(user, botname)
				else
					throw new Error(`Unknown action for telegrambot: ${action}. Supported actions are 'start' or 'stop'.`)
			}
		},
		jobs: {
			// 当 Fount 启动时，如果之前有正在运行的机器人，则重新启动它们
			ReStartJob: async (user, botname) => {
				await runBot(user, botname)
			}
		}
	}
}
