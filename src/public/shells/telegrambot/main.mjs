import { runBot, stopBot, getBotList, setBotConfig, deleteBotConfig, getBotConfig as getPartData, getBotConfigTemplate } from './src/server/bot.mjs'
import { setEndpoints } from './src/server/endpoints.mjs'

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
				const action = args[0]
				const botname = args[1]

				switch (action) {
					case 'list':
						console.log(getBotList(user))
						break
					case 'create':
						if (!botname) throw new Error('Bot name is required for create action.')
						setBotConfig(user, botname, {})
						console.log(`Bot '${botname}' created.`)
						break
					case 'delete':
						if (!botname) throw new Error('Bot name is required for delete action.')
						await deleteBotConfig(user, botname)
						console.log(`Bot '${botname}' deleted.`)
						break
					case 'config':
						if (!botname) throw new Error('Bot name is required for config action.')
						const configData = JSON.parse(args[2])
						await setBotConfig(user, botname, configData)
						console.log(`Bot '${botname}' configured.`)
						break
					case 'get-config':
						if (!botname) throw new Error('Bot name is required for get-config action.')
						console.log(await getPartData(user, botname))
						break
					case 'get-template':
						const charname = args[1]
						if (!charname) throw new Error('Char name is required for get-template action.')
						console.log(await getBotConfigTemplate(user, charname))
						break
					case 'start':
						if (!botname) throw new Error('Bot name is required for start action.')
						await runBot(user, botname)
						break
					case 'stop':
						if (!botname) throw new Error('Bot name is required for stop action.')
						await stopBot(user, botname)
						break
					default:
						throw `Unknown action: ${action}. Available actions: list, create, delete, config, get-config, get-template, start, stop`
				}
			},
			IPCInvokeHandler: async (user, { action, botname, configData, charname }) => {
				switch (action) {
					case 'list':
						return getBotList(user)
					case 'create':
						if (!botname) throw new Error('Bot name is required for create action.')
						setBotConfig(user, botname, {})
						return `Bot '${botname}' created.`
					case 'delete':
						if (!botname) throw new Error('Bot name is required for delete action.')
						await deleteBotConfig(user, botname)
						return `Bot '${botname}' deleted.`
					case 'config':
						if (!botname) throw new Error('Bot name is required for config action.')
						await setBotConfig(user, botname, configData)
						return `Bot '${botname}' configured.`
					case 'get-config':
						if (!botname) throw new Error('Bot name is required for get-config action.')
						return getPartData(user, botname)
					case 'get-template':
						if (!charname) throw new Error('Char name is required for get-template action.')
						return getBotConfigTemplate(user, charname)
					case 'start':
						if (!botname) throw new Error('Bot name is required for start action.')
						await runBot(user, botname)
						return `Bot '${botname}' started.`
					case 'stop':
						if (!botname) throw new Error('Bot name is required for stop action.')
						await stopBot(user, botname)
						return `Bot '${botname}' stopped.`
					default:
						throw `Unknown action: ${action}. Available actions: list, create, delete, config, get-config, get-template, start, stop`
				}
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