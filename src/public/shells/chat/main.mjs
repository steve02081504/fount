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
	info: {
		'en-UK': {
			name: 'Chat',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: 'Create and manage chat sessions with AI characters.',
			description_markdown: 'This shell allows you to start new chat sessions, load existing ones, and interact with AI characters in real-time.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['chat', 'AI', 'roleplay']
		},
		'zh-CN': {
			name: '聊天',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: '创建和管理与AI角色的聊天会话。',
			description_markdown: '此shell允许您开始新的聊天会话，加载现有会话，并与AI角色进行实时互动。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['聊天', 'AI', '角色扮演']
		},
		'ar-SA': {
			name: 'محادثة',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: 'إنشاء وإدارة جلسات الدردشة مع شخصيات الذكاء الاصطناعي.',
			description_markdown: 'يسمح لك هذا الصدفة ببدء جلسات دردشة جديدة ، وتحميل الجلسات الحالية ، والتفاعل مع شخصيات الذكاء الاصطناعي في الوقت الفعلي.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['الدردشة', 'الذكاء الاصطناعي', 'لعب الأدوار']
		},
		'de-DE': {
			name: 'Chat',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: 'Erstellen und Verwalten von Chat-Sitzungen mit KI-Charakteren.',
			description_markdown: 'Mit dieser Shell können Sie neue Chat-Sitzungen starten, vorhandene laden und in Echtzeit mit KI-Charakteren interagieren.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Chat', 'KI', 'Rollenspiel']
		},
		emoji: {
			name: '💬',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: 'Create and manage chat sessions with AI characters.',
			description_markdown: 'This shell allows you to start new chat sessions, load existing ones, and interact with AI characters in real-time.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['chat', 'AI', 'roleplay']
		},
		'es-ES': {
			name: 'Chat',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: 'Crea y gestiona sesiones de chat con personajes de IA.',
			description_markdown: 'Este shell te permite iniciar nuevas sesiones de chat, cargar las existentes e interactuar con personajes de IA en tiempo real.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['chat', 'IA', 'juego de rol']
		},
		'fr-FR': {
			name: 'Chat',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: 'Créez et gérez des sessions de chat avec des personnages IA.',
			description_markdown: 'Ce shell vous permet de démarrer de nouvelles sessions de chat, de charger celles qui existent déjà et d\'interagir avec des personnages IA en temps réel.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['chat', 'IA', 'jeu de rôle']
		},
		'hi-IN': {
			name: 'चैट',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: 'एआई पात्रों के साथ चैट सत्र बनाएं और प्रबंधित करें।',
			description_markdown: 'यह शेल आपको नए चैट सत्र शुरू करने, मौजूदा को लोड करने और एआई पात्रों के साथ वास्तविक समय में बातचीत करने की अनुमति देता है।',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['चैट', 'एआई', 'रोलप्ले']
		},
		'is-IS': {
			name: 'Spjall',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: 'Búðu til og stjórnaðu spjallrásum með gervigreindar persónum.',
			description_markdown: 'Þessi skel gerir þér kleift að hefja nýjar spjallrásir, hlaða inn þeim sem fyrir eru og hafa samskipti við gervigreindar persónur í rauntíma.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['spjall', 'gervigreind', 'hlutverkaleikur']
		},
		'it-IT': {
			name: 'Chat',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: 'Crea e gestisci sessioni di chat con personaggi IA.',
			description_markdown: 'Questa shell ti consente di avviare nuove sessioni di chat, caricare quelle esistenti e interagire con i personaggi IA in tempo reale.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['chat', 'IA', 'gioco di ruolo']
		},
		'ja-JP': {
			name: 'チャット',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: 'AIキャラクターとのチャットセッションを作成および管理します。',
			description_markdown: 'このシェルを使用すると、新しいチャットセッションを開始したり、既存のセッションを読み込んだり、AIキャラクターとリアルタイムで対話したりできます。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['チャット', 'AI', 'ロールプレイ']
		},
		'ko-KR': {
			name: '채팅',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: 'AI 캐릭터와의 채팅 세션을 만들고 관리합니다.',
			description_markdown: '이 셸을 사용하면 새 채팅 세션을 시작하고 기존 세션을 로드하며 AI 캐릭터와 실시간으로 상호 작용할 수 있습니다.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['채팅', 'AI', '롤플레잉']
		},
		lzh: {
			name: '清談',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: '創建和管理與AI角色的清談會話。',
			description_markdown: '此shell允許您開始新的清談會話，加載現有會話，並與AI角色進行實時互動。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['清談', 'AI', '角色扮演']
		},
		'nl-NL': {
			name: 'kletsen',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: 'Maak en beheer chatsessies met AI-personages.',
			description_markdown: 'Met deze shell kun je nieuwe chatsessies starten, bestaande laden en in realtime communiceren met AI-personages.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['chat', 'AI', 'rollenspel']
		},
		'pt-PT': {
			name: 'Chat',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: 'Crie e gerencie sessões de chat com personagens de IA.',
			description_markdown: 'Este shell permite que você inicie novas sessões de chat, carregue as existentes e interaja com personagens de IA em tempo real.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['chat', 'IA', 'roleplay']
		},
		'ru-RU': {
			name: 'Чат',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: 'Создавайте и управляйте сеансами чата с персонажами ИИ.',
			description_markdown: 'Эта оболочка позволяет вам начинать новые сеансы чата, загружать существующие и взаимодействовать с персонажами ИИ в режиме реального времени.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['чат', 'ИИ', 'ролевая игра']
		},
		'uk-UA': {
			name: 'чат',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: 'Створюйте та керуйте сеансами чату з персонажами ШІ.',
			description_markdown: 'Ця оболонка дозволяє вам починати нові сеанси чату, завантажувати існуючі та взаємодіяти з персонажами ШІ в режимі реального часу.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['чат', 'ШІ', 'рольова гра']
		},
		'vi-VN': {
			name: 'Chat',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: 'Tạo và quản lý các phiên trò chuyện với các nhân vật AI.',
			description_markdown: 'Shell này cho phép bạn bắt đầu các phiên trò chuyện mới, tải các phiên hiện có và tương tác với các nhân vật AI trong thời gian thực.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['trò chuyện', 'AI', 'nhập vai']
		},
		'zh-TW': {
			name: '聊天',
			avatar: 'https://api.iconify.design/fluent/chat-16-regular.svg',
			description: '創建和管理與AI角色的聊天會話。',
			description_markdown: '此shell允許您開始新的聊天會話，加載現有會話，並與AI角色進行實時互動。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['聊天', 'AI', '角色扮演']
		}
	},
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
