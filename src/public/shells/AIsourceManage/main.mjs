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
			name: 'AI Source Management',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: 'Manage AI sources for characters.',
			description_markdown: 'This shell allows you to add, remove, and configure AI sources, which characters use to connect to different AI models.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['AI', 'management', 'system']
		},
		'zh-CN': {
			name: 'AI源管理',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: '管理角色的AI源。',
			description_markdown: '此shell允许您添加、删除和配置AI源，角色使用这些源连接到不同的AI模型。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['AI', '管理', '系统']
		},
		'ar-SA': {
			name: 'إدارة مصدر الذكاء الاصطناعي',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: 'إدارة مصادر الذكاء الاصطناعي للشخصيات.',
			description_markdown: 'تسمح لك هذه الصدفة بإضافة مصادر الذكاء الاصطناعي وإزالتها وتكوينها ، والتي تستخدمها الشخصيات للاتصال بنماذج الذكاء الاصطناعي المختلفة.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['الذكاء الاصطناعي', 'إدارة', 'النظام']
		},
		'de-DE': {
			name: 'KI-Quellenverwaltung',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: 'Verwalten Sie KI-Quellen für Charaktere.',
			description_markdown: 'Mit dieser Shell können Sie KI-Quellen hinzufügen, entfernen und konfigurieren, die von Charakteren verwendet werden, um eine Verbindung zu verschiedenen KI-Modellen herzustellen.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['KI', 'Verwaltung', 'System']
		},
		emoji: {
			name: '🤖✍️',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: 'Manage AI sources for characters.',
			description_markdown: 'This shell allows you to add, remove, and configure AI sources, which characters use to connect to different AI models.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['AI', 'management', 'system']
		},
		'es-ES': {
			name: 'Gestión de fuentes de IA',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: 'Gestiona las fuentes de IA para los personajes.',
			description_markdown: 'Este shell te permite agregar, eliminar y configurar fuentes de IA, que los personajes usan para conectarse a diferentes modelos de IA.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['IA', 'gestión', 'sistema']
		},
		'fr-FR': {
			name: 'Gestion des sources d\'IA',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: 'Gérez les sources d\'IA pour les personnages.',
			description_markdown: 'Ce shell vous permet d\'ajouter, de supprimer et de configurer des sources d\'IA, que les personnages utilisent pour se connecter à différents modèles d\'IA.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['IA', 'gestion', 'système']
		},
		'hi-IN': {
			name: 'एआई स्रोत प्रबंधन',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: 'पात्रों के लिए एआई स्रोतों का प्रबंधन करें।',
			description_markdown: 'यह शेल आपको एआई स्रोतों को जोड़ने, हटाने और कॉन्फ़िगर करने की अनुमति देता है, जिसका उपयोग पात्र विभिन्न एआई मॉडल से जुड़ने के लिए करते हैं।',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['एआई', 'प्रबंधन', 'सिस्टम']
		},
		'is-IS': {
			name: 'Stjórnun gervigreindarheimilda',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: 'Hafa umsjón með gervigreindarheimildum fyrir persónur.',
			description_markdown: 'Þessi skel gerir þér kleift að bæta við, fjarlægja og stilla gervigreindarheimildir sem persónur nota til að tengjast mismunandi gervigreindarlíkönum.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['gervigreind', 'stjórnun', 'kerfi']
		},
		'it-IT': {
			name: 'Gestione fonti IA',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: 'Gestisci le fonti di intelligenza artificiale per i personaggi.',
			description_markdown: 'Questa shell ti consente di aggiungere, rimuovere e configurare le fonti di intelligenza artificiale, che i personaggi utilizzano per connettersi a diversi modelli di intelligenza artificiale.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['IA', 'gestione', 'sistema']
		},
		'ja-JP': {
			name: 'AIソース管理',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: 'キャラクターのAIソースを管理します。',
			description_markdown: 'このシェルを使用すると、キャラクターがさまざまなAIモデルに接続するために使用するAIソースを追加、削除、および構成できます。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['AI', '管理', 'システム']
		},
		'ko-KR': {
			name: 'AI 소스 관리',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: '캐릭터의 AI 소스를 관리합니다.',
			description_markdown: '이 셸을 사용하면 캐릭터가 다른 AI 모델에 연결하는 데 사용하는 AI 소스를 추가, 제거 및 구성할 수 있습니다.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['AI', '관리', '시스템']
		},
		lzh: {
			name: '智源管理',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: '管理角色的智源。',
			description_markdown: '此shell允許您添加、刪除和配置智源，角色使用這些源連接到不同的智源模型。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['智源', '管理', '系統']
		},
		'nl-NL': {
			name: 'AI-bronbeheer',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: 'Beheer AI-bronnen voor personages.',
			description_markdown: 'Met deze shell kunt u AI-bronnen toevoegen, verwijderen en configureren, die personages gebruiken om verbinding te maken met verschillende AI-modellen.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['AI', 'beheer', 'systeem']
		},
		'pt-PT': {
			name: 'Gerenciamento de fontes de IA',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: 'Gerencie fontes de IA para personagens.',
			description_markdown: 'Este shell permite que você adicione, remova e configure fontes de IA, que os personagens usam para se conectar a diferentes modelos de IA.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['IA', 'gerenciamento', 'sistema']
		},
		'ru-RU': {
			name: 'Управление источниками ИИ',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: 'Управляйте источниками ИИ для персонажей.',
			description_markdown: 'Эта оболочка позволяет добавлять, удалять и настраивать источники ИИ, которые персонажи используют для подключения к различным моделям ИИ.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['ИИ', 'управление', 'система']
		},
		'uk-UA': {
			name: 'Управління джерелами ШІ',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: 'Керуйте джерелами ШІ для персонажів.',
			description_markdown: 'Ця оболонка дозволяє додавати, видаляти та налаштовувати джерела ШІ, які персонажі використовують для підключення до різних моделей ШІ.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['ШІ', 'управління', 'система']
		},
		'vi-VN': {
			name: 'Quản lý nguồn AI',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: 'Quản lý các nguồn AI cho các nhân vật.',
			description_markdown: 'Shell này cho phép bạn thêm, xóa và định cấu hình các nguồn AI mà các nhân vật sử dụng để kết nối với các mô hình AI khác nhau.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['AI', 'quản lý', 'hệ thống']
		},
		'zh-TW': {
			name: 'AI源管理',
			avatar: 'https://api.iconify.design/line-md/engine.svg',
			description: '管理角色的AI源。',
			description_markdown: '此shell允許您添加、刪除和配置AI源，角色使用這些源連接到不同的AI模型。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['AI', '管理', '系統']
		}
	},
	Load: ({ router }) => {
		setEndpoints(router)
	},
	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const [action, sourceName, jsonData] = args
				const params = {
					sourceName,
					config: jsonData ? JSON.parse(jsonData) : undefined
				}
				const result = await handleAction(user, action, params)
				if (result !== undefined)
					console.log(result)

			},
			IPCInvokeHandler: async (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			}
		}
	}
}
