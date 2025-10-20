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
			name: 'Install',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "A shell to install parts.",
			"description_markdown": "Install new characters, personas, worlds, and other components from files or URLs.",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["install", "add", "import", "component"]
		},
		'zh-CN': {
			name: '安装',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "一个用于安装部件的shell。",
			"description_markdown": "从文件或 URL 安装新角色、角色、世界和其他组件。",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["安装", "添加", "导入", "组件"]
		},
		'ar-SA': {
			name: 'تثبيت',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "قذيفة لتثبيت أجزاء.",
			"description_markdown": "قم بتثبيت شخصيات وشخصيات وعوالم ومكونات أخرى جديدة من الملفات أو عناوين URL.",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["تثبيت", "إضافة", "استيراد", "مكون"]
		},
		'de-DE': {
			name: 'Installieren',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "Eine Shell zum Installieren von Teilen.",
			"description_markdown": "Installieren Sie neue Charaktere, Personas, Welten und andere Komponenten aus Dateien oder URLs.",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["installieren", "hinzufügen", "importieren", "Komponente"]
		},
		'emoji': {
			name: '📥',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "A shell to install parts.",
			"description_markdown": "Install new characters, personas, worlds, and other components from files or URLs.",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["install", "add", "import", "component"]
		},
		'es-ES': {
			name: 'Instalar',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "Un shell para instalar piezas.",
			"description_markdown": "Instale nuevos personajes, personas, mundos y otros componentes desde archivos o URL.",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["instalar", "agregar", "importar", "componente"]
		},
		'fr-FR': {
			name: 'Installer',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "Un shell pour installer des pièces.",
			"description_markdown": "Installez de nouveaux personnages, personas, mondes et autres composants à partir de fichiers ou d'URL.",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["installer", "ajouter", "importer", "composant"]
		},
		'hi-IN': {
			name: 'इंस्टॉल करें',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "भागों को स्थापित करने के लिए एक खोल।",
			"description_markdown": "फ़ाइलों या URL से नए वर्ण, व्यक्ति, दुनिया और अन्य घटक स्थापित करें।",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["इंस्टॉल करें", "जोड़ें", "आयात करें", "घटक"]
		},
		'is-IS': {
			name: 'Setja upp',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "Skél til að setja upp hluta.",
			"description_markdown": "Settu upp nýjar persónur, persónur, heima og aðra íhluti úr skrám eða vefslóðum.",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["setja upp", "bæta við", "flytja inn", "íhlutur"]
		},
		'it-IT': {
			name: 'Installa',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "Una shell per installare le parti.",
			"description_markdown": "Installa nuovi personaggi, personaggi, mondi e altri componenti da file o URL.",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["installa", "aggiungi", "importa", "componente"]
		},
		'ja-JP': {
			name: 'インストール',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "パーツをインストールするためのシェル。",
			"description_markdown": "ファイルまたはURLから新しいキャラクター、ペルソナ、ワールド、その他のコンポーネントをインストールします。",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["インストール", "追加", "インポート", "コンポーネント"]
		},
		'ko-KR': {
			name: '설치',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "부품을 설치하기 위한 셸입니다.",
			"description_markdown": "파일이나 URL에서 새로운 캐릭터, 페르소나, 세계 및 기타 구성 요소를 설치합니다.",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["설치", "추가", "가져오기", "구성 요소"]
		},
		'lzh': {
			name: '安裝',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "一個用於安裝部件的shell。",
			"description_markdown": "從文件或 URL 安裝新角色、角色、世界和其他組件。",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["安裝", "添加", "導入", "組件"]
		},
		'nl-NL': {
			name: 'Installeren',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "Een shell om onderdelen te installeren.",
			"description_markdown": "Installeer nieuwe personages, persona's, werelden en andere componenten vanuit bestanden of URL's.",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["installeren", "toevoegen", "importeren", "component"]
		},
		'pt-PT': {
			name: 'Instalar',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "Um shell para instalar peças.",
			"description_markdown": "Instale novos personagens, personas, mundos e outros componentes de arquivos ou URLs.",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["instalar", "adicionar", "importar", "componente"]
		},
		'ru-RU': {
			name: 'Установить',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "Оболочка для установки деталей.",
			"description_markdown": "Устанавливайте новых персонажей, персонажей, миры и другие компоненты из файлов или URL-адресов.",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["установить", "добавить", "импортировать", "компонент"]
		},
		'uk-UA': {
			name: 'Встановити',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "Оболонка для встановлення деталей.",
			"description_markdown": "Встановлюйте нових персонажів, персон, світів та інших компонентів з файлів або URL-адрес.",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["встановити", "додати", "імпортувати", "компонент"]
		},
		'vi-VN': {
			name: 'Cài đặt',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "Một trình bao để cài đặt các bộ phận.",
			"description_markdown": "Cài đặt các nhân vật, nhân vật, thế giới và các thành phần khác mới từ tệp hoặc URL.",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["cài đặt", "thêm", "nhập", "thành phần"]
		},
		'zh-TW': {
			name: '安裝',
			"avatar": "https://api.iconify.design/material-symbols/install-desktop.svg",
			"description": "一個用於安裝部件的shell。",
			"description_markdown": "從文件或 URL 安裝新角色、角色、世界和其他組件。",
			"version": "0.0.1",
			"author": "steve02081504",
			"tags": ["安裝", "添加", "導入", "組件"]
		}
	},
	Load: ({ router }) => {
		setEndpoints(router)
	},

	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const action = args[0]
				let params = {}
				if (action === 'install')
					params = { input: args[1] }
				else if (action === 'uninstall')
					params = { partType: args[1], partName: args[2] }

				const result = await handleAction(user, action, params)
				console.log(result)
			},
			IPCInvokeHandler: async (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			}
		}
	}
}
