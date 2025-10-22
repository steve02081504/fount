import { LoadChar } from '../../../server/managers/char_manager.mjs'
import { unlockAchievement } from '../achievements/src/api.mjs'

import { setEndpoints } from './src/endpoints.mjs'

export default {
	info: {
		'en-UK': {
			name: 'Terminal Assist',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: 'Interactive terminal access within fount.',
			description_markdown: 'Provides an interactive terminal connected to the fount server environment, allowing for direct command-line operations.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['terminal', 'shell', 'assist', 'developer']
		},
		'zh-CN': {
			name: '终端辅助',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: '在 fount 内进行交互式终端访问。',
			description_markdown: '提供连接到 fount 服务器环境的交互式终端，允许直接进行命令行操作。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['终端', '命令行', '辅助', '开发者']
		},
		'ar-SA': {
			name: 'المساعدة الطرفية',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: 'الوصول إلى المحطة التفاعلية داخل fount.',
			description_markdown: 'يوفر محطة تفاعلية متصلة ببيئة خادم fount، مما يسمح بعمليات سطر الأوامر المباشرة.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['محطة', 'صدفة', 'مساعدة', 'مطور']
		},
		'de-DE': {
			name: 'Terminal-Assistenz',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: 'Interaktiver Terminalzugriff innerhalb von fount.',
			description_markdown: 'Bietet ein interaktives Terminal, das mit der fount-Serverumgebung verbunden ist und direkte Befehlszeilenoperationen ermöglicht.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Terminal', 'Shell', 'Assistenz', 'Entwickler']
		},
		emoji: {
			name: '💻🦾',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: 'Interactive terminal access within fount.',
			description_markdown: 'Provides an interactive terminal connected to the fount server environment, allowing for direct command-line operations.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['terminal', 'shell', 'assist', 'developer']
		},
		'es-ES': {
			name: 'Asistencia de Terminal',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: 'Acceso interactivo a la terminal dentro de fount.',
			description_markdown: 'Proporciona una terminal interactiva conectada al entorno del servidor fount, lo que permite operaciones directas de línea de comandos.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['terminal', 'shell', 'asistencia', 'desarrollador']
		},
		'fr-FR': {
			name: 'Assistant Terminal',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: 'Accès interactif au terminal dans fount.',
			description_markdown: 'Fournit un terminal interactif connecté à l\'environnement du serveur fount, permettant des opérations directes en ligne de commande.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['terminal', 'shell', 'assistant', 'développeur']
		},
		'hi-IN': {
			name: 'टर्मिनल असिस्ट',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: 'फाउंट के भीतर इंटरैक्टिव टर्मिनल एक्सेस।',
			description_markdown: 'फाउंट सर्वर वातावरण से जुड़ा एक इंटरैक्टिव टर्मिनल प्रदान करता है, जो सीधे कमांड-लाइन संचालन की अनुमति देता है।',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['टर्मिनल', 'शेल', 'सहायता', 'डेवलपर']
		},
		'is-IS': {
			name: 'Terminalaðstoð',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: 'Gagnvirkur flugstöðvaraðgangur innan fount.',
			description_markdown: 'Býður upp á gagnvirka flugstöð sem er tengd við fount netþjónaumhverfið, sem gerir beinar skipanalínuaðgerðir kleift.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['flugstöð', 'skel', 'aðstoð', 'hönnuður']
		},
		'it-IT': {
			name: 'Assistenza Terminale',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: 'Accesso interattivo al terminale all\'interno di fount.',
			description_markdown: 'Fornisce un terminale interattivo connesso all\'ambiente del server fount, consentendo operazioni dirette da riga di comando.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['terminale', 'shell', 'assistenza', 'sviluppatore']
		},
		'ja-JP': {
			name: 'ターミナルアシスト',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: 'Fount内の対話型ターミナルアクセス。',
			description_markdown: 'Fountサーバー環境に接続された対話型ターミナルを提供し、直接のコマンドライン操作を可能にします。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ターミナル', 'シェル', 'アシスト', '開発者']
		},
		'ko-KR': {
			name: '터미널 지원',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: 'fount 내의 대화형 터미널 액세스.',
			description_markdown: 'fount 서버 환경에 연결된 대화형 터미널을 제공하여 직접적인 명령줄 작업을 허용합니다.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['터미널', '셸', '지원', '개발자']
		},
		lzh: {
			name: '終端輔佐',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: '在 fount 內進行交互式終端訪問。',
			description_markdown: '提供連接到 fount 服務器環境的交互式終端，允許直接進行命令行操作。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['終端', '命令行', '輔佐', '開發者']
		},
		'nl-NL': {
			name: 'Terminale assistentie',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: 'Interactieve terminaltoegang binnen fount.',
			description_markdown: 'Biedt een interactieve terminal die is verbonden met de fount-serveromgeving, waardoor directe opdrachtregelbewerkingen mogelijk zijn.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['terminal', 'shell', 'assistentie', 'ontwikkelaar']
		},
		'pt-PT': {
			name: 'Assistente de Terminal',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: 'Acesso interativo ao terminal dentro do fount.',
			description_markdown: 'Fornece um terminal interativo conectado ao ambiente do servidor fount, permitindo operações diretas de linha de comando.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['terminal', 'shell', 'assistente', 'desenvolvedor']
		},
		'ru-RU': {
			name: 'Терминальный помощник',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: 'Интерактивный доступ к терминалу в fount.',
			description_markdown: 'Предоставляет интерактивный терминал, подключенный к серверной среде fount, что позволяет выполнять прямые операции командной строки.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['терминал', 'оболочка', 'помощник', 'разработчик']
		},
		'uk-UA': {
			name: 'Термінальний асистент',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: 'Інтерактивний доступ до терміналу в fount.',
			description_markdown: 'Надає інтерактивний термінал, підключений до серверного середовища fount, що дозволяє виконувати прямі операції командного рядка.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['термінал', 'оболонка', 'асистент', 'розробник']
		},
		'vi-VN': {
			name: 'Hỗ trợ Terminal',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: 'Truy cập terminal tương tác trong fount.',
			description_markdown: 'Cung cấp một terminal tương tác được kết nối với môi trường máy chủ fount, cho phép các thao tác dòng lệnh trực tiếp.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['terminal', 'shell', 'hỗ trợ', 'nhà phát triển']
		},
		'zh-TW': {
			name: '終端輔助',
			avatar: 'https://api.iconify.design/line-md/laptop.svg',
			description: '在 fount 內進行交互式終端訪問。',
			description_markdown: '提供連接到 fount 服務器環境的交互式終端，允許直接進行命令行操作。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['終端', '命令行', '輔助', '開發者']
		}
	},
	Load: ({ router }) => {
		setEndpoints(router)
	},
	interfaces: {
		invokes: {
			IPCInvokeHandler: async (username, data) => {
				unlockAchievement(username, 'shells', 'shellassist', 'invoke_shell_assist')
				const char = await LoadChar(username, data.charname)
				if (!char.interfaces.shellassist) {
					const { GetDefaultShellAssistInterface } = await import('./src/default_interface/main.mjs')
					char.interfaces.shellassist = await GetDefaultShellAssistInterface(char, username, data.charname)
				}
				const result = await char.interfaces.shellassist.Assist({
					...data,
					username,
					UserCharname: data.UserCharname || username,
					chat_scoped_char_memory: data.chat_scoped_char_memorys[data.charname] || {},
					chat_scoped_char_memorys: undefined
				})
				return {
					...result,
					chat_scoped_char_memorys: {
						...data.chat_scoped_char_memorys,
						[data.charname]: result.chat_scoped_char_memory
					},
					chat_scoped_char_memory: undefined
				}
			}
		}
	}
}
