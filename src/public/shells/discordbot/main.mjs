import { runBot } from './src/bot.mjs'
import { setEndpoints } from './src/endpoints.mjs'

async function handleAction(user, action, params) {
	const { actions } = await import('./src/actions.mjs')
	if (!actions[action])
		throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)

	return actions[action]({ user, ...params })
}

export default {
	info: {
		'en-UK': {
			name: 'Discord Bot',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: 'Run your character as a Discord bot.',
			description_markdown: 'Allows you to connect your character to Discord and interact with them as a bot.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['discord', 'bot', 'integration']
		},
		'zh-CN': {
			name: 'Discord Bot',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: '将您的角色作为Discord机器人运行。',
			description_markdown: '允许您将角色连接到Discord并作为机器人与他们互动。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Discord', '机器人', '集成']
		},
		'ar-SA': {
			name: 'Discord Bot',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: 'قم بتشغيل شخصيتك كروبوت Discord.',
			description_markdown: 'يسمح لك بربط شخصيتك بـ Discord والتفاعل معها كروبوت.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['ديسكورد', 'بوت', 'تكامل']
		},
		'de-DE': {
			name: 'Discord-Bot',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: 'Führe deinen Charakter als Discord-Bot aus.',
			description_markdown: 'Ermöglicht es Ihnen, Ihren Charakter mit Discord zu verbinden und mit ihm als Bot zu interagieren.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Discord', 'Bot', 'Integration']
		},
		emoji: {
			name: '🤖💬🎮',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: 'Run your character as a Discord bot.',
			description_markdown: 'Allows you to connect your character to Discord and interact with them as a bot.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['discord', 'bot', 'integration']
		},
		'es-ES': {
			name: 'Bot de Discord',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: 'Ejecuta tu personaje como un bot de Discord.',
			description_markdown: 'Te permite conectar tu personaje a Discord e interactuar con él como un bot.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Discord', 'bot', 'integración']
		},
		'fr-FR': {
			name: 'Bot Discord',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: 'Exécutez votre personnage en tant que bot Discord.',
			description_markdown: 'Vous permet de connecter votre personnage à Discord et d\'interagir avec lui en tant que bot.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Discord', 'bot', 'intégration']
		},
		'hi-IN': {
			name: 'डिस्कॉर्ड बॉट',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: 'अपने चरित्र को डिस्कॉर्ड बॉट के रूप में चलाएं।',
			description_markdown: 'आपको अपने चरित्र को डिस्कॉर्ड से जोड़ने और बॉट के रूप में उनके साथ बातचीत करने की अनुमति देता है।',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['डिस्कॉर्ड', 'बॉट', 'एकीकरण']
		},
		'is-IS': {
			name: 'Discord Bot',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: 'Keyrðu karakterinn þinn sem Discord bot.',
			description_markdown: 'Gerir þér kleift að tengja karakterinn þinn við Discord og eiga samskipti við hann sem bot.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Discord', 'bot', 'samþætting']
		},
		'it-IT': {
			name: 'Bot Discord',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: 'Esegui il tuo personaggio come un bot Discord.',
			description_markdown: 'Ti permette di collegare il tuo personaggio a Discord e interagire con esso come un bot.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Discord', 'bot', 'integrazione']
		},
		'ja-JP': {
			name: 'Discordボット',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: 'キャラクターをDiscordボットとして実行します。',
			description_markdown: 'キャラクターをDiscordに接続し、ボットとして対話することができます。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Discord', 'ボット', '統合']
		},
		'ko-KR': {
			name: '디스코드 봇',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: '캐릭터를 디스코드 봇으로 실행하세요.',
			description_markdown: '캐릭터를 디스코드에 연결하고 봇으로 상호 작용할 수 있습니다.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['디스코드', '봇', '통합']
		},
		lzh: {
			name: 'Discord靈偶',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: '以Discord靈偶身份運行您的角色。',
			description_markdown: '允許您將角色連接到Discord並作為靈偶與之互動。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Discord', '靈偶', '集成']
		},
		'nl-NL': {
			name: 'Discord-bot',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: 'Voer je personage uit als een Discord-bot.',
			description_markdown: 'Hiermee kun je je personage verbinden met Discord en ermee communiceren als een bot.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Discord', 'bot', 'integratie']
		},
		'pt-PT': {
			name: 'Bot do Discord',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: 'Execute seu personagem como um bot do Discord.',
			description_markdown: 'Permite que você conecte seu personagem ao Discord e interaja com ele como um bot.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Discord', 'bot', 'integração']
		},
		'ru-RU': {
			name: 'Discord-бот',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: 'Запустите своего персонажа в качестве бота Discord.',
			description_markdown: 'Позволяет подключить вашего персонажа к Discord и взаимодействовать с ним как с ботом.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Discord', 'бот', 'интеграция']
		},
		'uk-UA': {
			name: 'Discord-бот',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: 'Запустіть свого персонажа як бота Discord.',
			description_markdown: 'Дозволяє підключити вашого персонажа до Discord і взаємодіяти з ним як з ботом.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Discord', 'бот', 'інтеграція']
		},
		'vi-VN': {
			name: 'Bot Discord',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: 'Chạy nhân vật của bạn dưới dạng bot Discord.',
			description_markdown: 'Cho phép bạn kết nối nhân vật của mình với Discord và tương tác với chúng dưới dạng bot.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Discord', 'bot', 'tích hợp']
		},
		'zh-TW': {
			name: 'Discord Bot',
			avatar: 'https://api.iconify.design/line-md/discord.svg',
			description: '將您的角色作為Discord機器人運行。',
			description_markdown: '允許您將角色連接到Discord並作為機器人與他們互動。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Discord', '機器人', '集成']
		}
	},
	Load: async ({ router }) => {
		setEndpoints(router)
	},
	Unload: async () => { },

	interfaces: {
		invokes: {
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
