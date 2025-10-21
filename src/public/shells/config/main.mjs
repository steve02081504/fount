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
			name: 'Component Configuration',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: 'Configure fount components.',
			description_markdown: 'This shell allows you to get, set, and list configurations for various parts of fount, including characters, personas, and worlds.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['config', 'settings', 'management']
		},
		'zh-CN': {
			name: '组件配置',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: '配置Fount组件。',
			description_markdown: '此shell允许您获取、设置和列出Fount各个部分的配置，包括角色、人格和世界。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['配置', '设置', '管理']
		},
		'ar-SA': {
			name: 'تكوين المكون',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: 'تكوين مكونات fount.',
			description_markdown: 'تسمح لك هذه الصدفة بالحصول على تكوينات لأجزاء مختلفة من fount وتعيينها وإدراجها ، بما في ذلك الشخصيات والشخصيات والعوالم.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['التكوين', 'الإعدادات', 'الإدارة']
		},
		'de-DE': {
			name: 'Komponentenkonfiguration',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: 'Konfigurieren Sie fount-Komponenten.',
			description_markdown: 'Mit dieser Shell können Sie Konfigurationen für verschiedene Teile von fount abrufen, festlegen und auflisten, einschließlich Zeichen, Personas und Welten.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Konfiguration', 'Einstellungen', 'Verwaltung']
		},
		emoji: {
			name: '🧩⚙️',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: 'Configure fount components.',
			description_markdown: 'This shell allows you to get, set, and list configurations for various parts of fount, including characters, personas, and worlds.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['config', 'settings', 'management']
		},
		'es-ES': {
			name: 'Configuración de Componente',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: 'Configure los componentes de fount.',
			description_markdown: 'Este shell le permite obtener, establecer y enumerar configuraciones para varias partes de fount, incluidos personajes, personas y mundos.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['configuración', 'ajustes', 'administración']
		},
		'fr-FR': {
			name: 'Configuration des Composants',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: 'Configurez les composants fount.',
			description_markdown: 'Ce shell vous permet d\'obtenir, de définir et de lister les configurations de différentes parties de fount, y compris les personnages, les personnages et les mondes.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['configuration', 'paramètres', 'gestion']
		},
		'hi-IN': {
			name: 'घटक कॉन्फ़िगरेशन',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: 'फाउंट घटकों को कॉन्फ़िगर करें।',
			description_markdown: 'यह शेल आपको पात्रों, व्यक्तित्वों और दुनिया सहित फाउंट के विभिन्न हिस्सों के लिए कॉन्फ़िगरेशन प्राप्त करने, सेट करने और सूचीबद्ध करने की अनुमति देता है।',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['कॉन्फ़िगरेशन', 'सेटिंग्स', 'प्रबंधन']
		},
		'is-IS': {
			name: 'Stillingar íhluta',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: 'Stilltu fount íhluti.',
			description_markdown: 'Þessi skel gerir þér kleift að fá, stilla og skrá stillingar fyrir ýmsa hluta fount, þar á meðal stafi, persónur og heima.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['stillingar', 'stillingar', 'stjórnun']
		},
		'it-IT': {
			name: 'Configurazione Componente',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: 'Configura i componenti di fount.',
			description_markdown: 'Questa shell consente di ottenere, impostare ed elencare le configurazioni per varie parti di fount, inclusi personaggi, personaggi e mondi.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['configurazione', 'impostazioni', 'gestione']
		},
		'ja-JP': {
			name: 'コンポーネント設定',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: 'Fountコンポーネントを構成します。',
			description_markdown: 'このシェルを使用すると、キャラクター、ペルソナ、ワールドなど、Fountのさまざまな部分の構成を取得、設定、一覧表示できます。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['設定', '設定', '管理']
		},
		'ko-KR': {
			name: '컴포넌트 설정',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: 'fount 구성 요소를 구성합니다.',
			description_markdown: '이 셸을 사용하면 캐릭터, 페르소나 및 세계를 포함하여 Fount의 다양한 부분에 대한 구성을 가져오고 설정하고 나열할 수 있습니다.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['구성', '설정', '관리']
		},
		lzh: {
			name: '器之規度',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: '規度Fount組件。',
			description_markdown: '此shell允許您獲取、規度並列出Fount各部分的規度，包括角色、角色和世界。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['規度', '規度', '管理']
		},
		'nl-NL': {
			name: 'Componentconfiguratie',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: 'Configureer fount-componenten.',
			description_markdown: 'Met deze shell kunt u configuraties voor verschillende onderdelen van fount ophalen, instellen en weergeven, inclusief personages, persona\'s en werelden.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['configuratie', 'instellingen', 'beheer']
		},
		'pt-PT': {
			name: 'Configuração de Componente',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: 'Configure os componentes do fount.',
			description_markdown: 'Este shell permite que você obtenha, defina e liste configurações para várias partes do fount, incluindo personagens, personas e mundos.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['configuração', 'configurações', 'gerenciamento']
		},
		'ru-RU': {
			name: 'Настройка компонента',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: 'Настройте компоненты fount.',
			description_markdown: 'Эта оболочка позволяет получать, устанавливать и перечислять конфигурации для различных частей fount, включая персонажей, персонажей и миры.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['конфигурация', 'настройки', 'управление']
		},
		'uk-UA': {
			name: 'Конфігурація компонентів',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: 'Налаштуйте компоненти fount.',
			description_markdown: 'Ця оболонка дозволяє отримувати, встановлювати та перераховувати конфігурації для різних частин fount, включаючи персонажів, персон та світів.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['конфігурація', 'налаштування', 'управління']
		},
		'vi-VN': {
			name: 'Cấu hình thành phần',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: 'Cấu hình các thành phần fount.',
			description_markdown: 'Shell này cho phép bạn lấy, đặt và liệt kê các cấu hình cho các bộ phận khác nhau của fount, bao gồm các ký tự, nhân vật và thế giới.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['cấu hình', 'cài đặt', 'quản lý']
		},
		'zh-TW': {
			name: '組件配置',
			avatar: 'https://api.iconify.design/line-md/cog.svg',
			description: '配置Fount組件。',
			description_markdown: '此shell允許您獲取、設置和列出Fount各個部分的配置，包括角色、角色和世界。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['配置', '設置', '管理']
		}
	},
	Load: ({ router }) => {
		setEndpoints(router)
	},
	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const [action, partType, partName, jsonData] = args
				const params = {
					partType,
					partName,
					data: jsonData ? JSON.parse(jsonData) : undefined
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
