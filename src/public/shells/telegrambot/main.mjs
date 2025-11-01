import { actions } from './src/actions.mjs'
import { runBot } from './src/bot.mjs'
import { setEndpoints } from './src/endpoints.mjs'

/** @typedef {import('../../../decl/basedefs.ts').info_t} info_t */

/**
 * telegrambot 的入口点。
 */

/**
 * 处理传入的Telegram机器人动作请求。
 * @param {string} user - 用户名。
 * @param {string} action - 要执行的动作名称。
 * @param {object} params - 动作所需的参数。
 * @returns {Promise<any>} - 返回动作执行的结果。
 */
async function handleAction(user, action, params) {
	if (!actions[action])
		throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)

	return actions[action]({ user, ...params })
}

/**
 * @type {import('../../../decl/shell.ts').shell_t}
 */
export default {
	/**
	 * Shell 的信息。
	 * @type {info_t}
	 */
	info: {
		'en-UK': {
			name: 'Telegram Bot',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: 'Run your character as a Telegram Bot.',
			description_markdown: 'Integrate your fount character with Telegram to interact with users on the platform.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['telegram', 'bot', 'chat', 'integration']
		},
		'zh-CN': {
			name: 'Telegram Bot',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: '将您的角色作为 Telegram Bot 运行。',
			description_markdown: '将您的 fount 角色与 Telegram 集成，以便在该平台上与用户互动。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Telegram', 'bot', '聊天', '集成']
		},
		'ar-SA': {
			name: 'Telegram Bot',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: 'قم بتشغيل شخصيتك كـ Telegram Bot.',
			description_markdown: 'ادمج شخصية fount الخاصة بك مع Telegram للتفاعل مع المستخدمين على المنصة.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Telegram', 'بوت', 'دردشة', 'تكامل']
		},
		'de-DE': {
			name: 'Telegram Bot',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: 'Führen Sie Ihren Charakter als Telegram Bot aus.',
			description_markdown: 'Integrieren Sie Ihren fount-Charakter in Telegram, um mit Benutzern auf der Plattform zu interagieren.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Telegram', 'Bot', 'Chat', 'Integration']
		},
		emoji: {
			name: '🤖✈️',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: 'Run your character as a Telegram Bot.',
			description_markdown: 'Integrate your fount character with Telegram to interact with users on the platform.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['telegram', 'bot', 'chat', 'integration']
		},
		'es-ES': {
			name: 'Bot de Telegram',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: 'Ejecuta tu personaje como un Bot de Telegram.',
			description_markdown: 'Integra tu personaje de fount con Telegram para interactuar con los usuarios de la plataforma.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Telegram', 'bot', 'chat', 'integración']
		},
		'fr-FR': {
			name: 'Bot Telegram',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: 'Exécutez votre personnage en tant que bot Telegram.',
			description_markdown: 'Intégrez votre personnage fount à Telegram pour interagir avec les utilisateurs sur la plateforme.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Telegram', 'bot', 'chat', 'intégration']
		},
		'hi-IN': {
			name: 'टेलीग्राम बॉट',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: 'अपने चरित्र को टेलीग्राम बॉट के रूप में चलाएं।',
			description_markdown: 'प्लेटफ़ॉर्म पर उपयोगकर्ताओं के साथ बातचीत करने के लिए अपने फ़ाउंट चरित्र को टेलीग्राम के साथ एकीकृत करें।',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['टेलीग्राम', 'बॉट', 'चैट', 'एकीकरण']
		},
		'is-IS': {
			name: 'Telegram Bot',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: 'Keyrðu karakterinn þinn sem Telegram Bot.',
			description_markdown: 'Samþættu fount karakterinn þinn við Telegram til að eiga samskipti við notendur á pallinum.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Telegram', 'bot', 'spjall', 'samþætting']
		},
		'it-IT': {
			name: 'Bot di Telegram',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: 'Esegui il tuo personaggio come un bot di Telegram.',
			description_markdown: 'Integra il tuo personaggio fount con Telegram per interagire con gli utenti sulla piattaforma.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Telegram', 'bot', 'chat', 'integrazione']
		},
		'ja-JP': {
			name: 'Telegramボット',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: 'キャラクターをTelegramボットとして実行します。',
			description_markdown: 'fountキャラクターをTelegramと統合して、プラットフォーム上のユーザーと対話します。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Telegram', 'ボット', 'チャット', '統合']
		},
		'ko-KR': {
			name: '텔레그램 봇',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: '캐릭터를 텔레그램 봇으로 실행하세요.',
			description_markdown: 'fount 캐릭터를 텔레그램과 통합하여 플랫폼에서 사용자와 상호 작용합니다.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['텔레그램', '봇', '채팅', '통합']
		},
		lzh: {
			name: 'Telegram 靈偶',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: '將您的角色作為 Telegram Bot 運行。',
			description_markdown: '將您的 fount 角色與 Telegram 集成，以便在該平台上與用戶互動。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Telegram', '靈偶', '聊天', '集成']
		},
		'nl-NL': {
			name: 'Telegram Bot',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: 'Voer je personage uit als een Telegram Bot.',
			description_markdown: 'Integreer je fount-personage met Telegram om met gebruikers op het platform te communiceren.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Telegram', 'bot', 'chat', 'integratie']
		},
		'pt-PT': {
			name: 'Bot do Telegram',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: 'Execute seu personagem como um Bot do Telegram.',
			description_markdown: 'Integre seu personagem fount com o Telegram para interagir com os usuários na plataforma.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Telegram', 'bot', 'chat', 'integração']
		},
		'ru-RU': {
			name: 'Telegram-бот',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: 'Запустите своего персонажа как Telegram-бота.',
			description_markdown: 'Интегрируйте своего персонажа fount с Telegram для взаимодействия с пользователями на платформе.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Telegram', 'бот', 'чат', 'интеграция']
		},
		'uk-UA': {
			name: 'Telegram-бот',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: 'Запустіть свого персонажа як Telegram-бота.',
			description_markdown: 'Інтегруйте свого персонажа fount з Telegram для взаємодії з користувачами на платформі.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Telegram', 'бот', 'чат', 'інтеграція']
		},
		'vi-VN': {
			name: 'Bot Telegram',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: 'Chạy nhân vật của bạn như một Bot Telegram.',
			description_markdown: 'Tích hợp nhân vật fount của bạn với Telegram để tương tác với người dùng trên nền tảng.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Telegram', 'bot', 'trò chuyện', 'tích hợp']
		},
		'zh-TW': {
			name: 'Telegram Bot',
			avatar: 'https://api.iconify.design/line-md/telegram.svg',
			description: '將您的角色作為 Telegram Bot 運行。',
			description_markdown: '將您的 fount 角色與 Telegram 集成，以便在該平台上與用戶互動。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Telegram', 'bot', '聊天', '集成']
		}
	},
	/**
	 * 加载Telegram机器人Shell并设置API端点。
	 * @param {object} options - 选项。
	 * @param {object} options.router - Express的路由实例。
	 */
	Load: async ({ router }) => {
		// 设置此 shell 的 API 端点
		setEndpoints(router)
	},
	/**
	 * 卸载Telegram机器人Shell。
	 */
	Unload: async () => {
		// 在卸载 shell 时可以进行一些清理工作，如果需要的话
		// 例如，确保所有bot实例都已停止（尽管 on_shutdown 应该处理这个）
	},
	/**
	 * Shell的接口定义。
	 */
	interfaces: {
		/**
		 * 调用接口的定义。
		 */
		invokes: {
			/**
			 * 处理命令行参数以执行Telegram机器人操作。
			 * @param {string} user - 用户名。
			 * @param {Array<string>} args - 命令行参数数组。
			 */
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
			/**
			 * 处理IPC调用以执行Telegram机器人操作。
			 * @param {string} user - 用户名。
			 * @param {object} data - 从IPC接收的数据对象。
			 * @returns {Promise<any>} - 动作执行结果。
			 */
			IPCInvokeHandler: async (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			}
		},
		/**
		 * 任务接口的定义。
		 */
		jobs: {
			/**
			 * 重新启动Telegram机器人任务。
			 * @param {string} user - 用户名。
			 * @param {string} botname - 机器人名称。
			 */
			// 当 fount 启动时，如果之前有正在运行的bot，则重新启动它们
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
