import { setEndpoints } from './src/endpoints.mjs'

/**
 * 处理动作。
 * @param {string} user - 用户。
 * @param {string} action - 动作。
 * @param {object} params - 参数。
 * @returns {Promise<any>} - 动作结果。
 */
async function handleAction(user, action, params) {
	const { actions } = await import('./src/actions.mjs')
	if (!actions[action])
		throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)

	return actions[action]({ user, ...params })
}

/**
 * 桌面宠物Shell
 */
export default {
	info: {
		'en-UK': {
			name: 'Desktop Pets',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: 'Run your character as a desktop pet.',
			description_markdown: 'Allows characters to be displayed as interactive desktop pets in a borderless, transparent window.',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['desktop', 'pet', 'webview']
		},
		'zh-CN': {
			name: '桌面宠物',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: '将您的角色作为桌面宠物运行。',
			description_markdown: '允许角色在无边框、透明的窗口中显示为交互式桌面宠物。',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['桌面', '宠物', '网页视图']
		},
		'ar-SA': {
			name: 'الحيوانات الأليفة سطح المكتب',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: 'قم بتشغيل شخصيتك كحيوان أليف لسطح المكتب.',
			description_markdown: 'يسمح بعرض الأحرف كحيوانات أليفة تفاعلية لسطح المكتب في نافذة شفافة بلا حدود.',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['سطح المكتب', 'حيوان أليف', 'عرض ويب']
		},
		'de-DE': {
			name: 'Desktop-Haustiere',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: 'Führen Sie Ihren Charakter als Desktop-Haustier aus.',
			description_markdown: 'Ermöglicht die Anzeige von Zeichen als interaktive Desktop-Haustiere in einem randlosen, transparenten Fenster.',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['Desktop', 'Haustier', 'Webansicht']
		},
		emoji: {
			name: '🐾',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: 'Run your character as a desktop pet.',
			description_markdown: 'Allows characters to be displayed as interactive desktop pets in a borderless, transparent window.',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['desktop', 'pet', 'webview']
		},
		'es-ES': {
			name: 'mascotas de escritorio',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: 'Ejecuta tu personaje como una mascota de escritorio.',
			description_markdown: 'Permite que los personajes se muestren como mascotas de escritorio interactivas en una ventana transparente y sin bordes.',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['escritorio', 'mascota', 'vista web']
		},
		'fr-FR': {
			name: 'Animaux de bureau',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: 'Exécutez votre personnage comme un animal de compagnie de bureau.',
			description_markdown: 'Permet d\'afficher les personnages sous forme d\'animaux de bureau interactifs dans une fenêtre transparente sans bordure.',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['bureau', 'animal de compagnie', 'vue Web']
		},
		'hi-IN': {
			name: 'डेस्कटॉप पालतू जानवर',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: 'अपने चरित्र को डेस्कटॉप पालतू जानवर के रूप में चलाएं।',
			description_markdown: 'पात्रों को एक सीमा रहित, पारदर्शी विंडो में इंटरैक्टिव डेस्कटॉप पालतू जानवरों के रूप में प्रदर्शित करने की अनुमति देता है।',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['डेस्कटॉप', 'पालतू जानवर', 'वेबव्यू']
		},
		'is-IS': {
			name: 'Gæludýr skrifborðs',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: 'Keyrðu karakterinn þinn sem skjáborðsgæludýr.',
			description_markdown: 'Leyfir stöfum að birtast sem gagnvirk skjáborðsgæludýr í rammalausum, gagnsæjum glugga.',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['skrifborð', 'gæludýr', 'vefsýn']
		},
		'it-IT': {
			name: 'Animali domestici da scrivania',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: 'Gestisci il tuo personaggio come un animale domestico da scrivania.',
			description_markdown: 'Consente di visualizzare i personaggi come animali domestici interattivi sul desktop in una finestra trasparente e senza bordi.',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['desktop', 'animale domestico', 'vista web']
		},
		'ja-JP': {
			name: 'デスクトップペット',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: 'キャラクターをデスクトップペットとして実行します。',
			description_markdown: 'キャラクターを、枠のない透明なウィンドウに対話型のデスクトップペットとして表示できます。',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['デスクトップ', 'ペット', 'ウェブビュー']
		},
		'ko-KR': {
			name: '데스크톱 애완동물',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: '캐릭터를 데스크톱 애완동물로 실행하세요.',
			description_markdown: '테두리가 없고 투명한 창에 문자를 대화형 데스크톱 애완동물로 표시할 수 있습니다.',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['데스크톱', '애완동물', '웹뷰']
		},
		lzh: {
			name: '桌面宠物',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: '將您的角色作為桌面寵物運行。',
			description_markdown: '允許角色在無邊框、透明的窗口中顯示為交互式桌面寵物。',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['桌面', '寵物', '網頁視圖']
		},
		'nl-NL': {
			name: 'Desktop huisdieren',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: 'Voer je personage uit als een bureaubladhuisdier.',
			description_markdown: 'Hiermee kunnen personages worden weergegeven als interactieve bureaubladhuisdieren in een randloos, transparant venster.',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['desktop', 'huisdier', 'webview']
		},
		'pt-PT': {
			name: 'Animais de estimação de mesa',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: 'Execute seu personagem como um animal de estimação de desktop.',
			description_markdown: 'Permite que os personagens sejam exibidos como animais de estimação de desktop interativos em uma janela transparente e sem bordas.',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['desktop', 'animal de estimação', 'webview']
		},
		'ru-RU': {
			name: 'Настольные питомцы',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: 'Запустите своего персонажа в качестве настольного питомца.',
			description_markdown: 'Позволяет отображать персонажей в виде интерактивных настольных питомцев в прозрачном окне без полей.',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['рабочий стол', 'питомец', 'веб-просмотр']
		},
		'uk-UA': {
			name: 'Настільні домашні тварини',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: 'Запустіть свого персонажа як настільного улюбленця.',
			description_markdown: 'Дозволяє відображати персонажів у вигляді інтерактивних настільних улюбленців у прозорому вікні без полів.',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['робочий стіл', 'домашній улюбленець', 'веб-перегляд']
		},
		'vi-VN': {
			name: 'Thú cưng để bàn',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: 'Chạy nhân vật của bạn như một con vật cưng trên máy tính để bàn.',
			description_markdown: 'Cho phép các ký tự được hiển thị dưới dạng vật nuôi trên máy tính để bàn tương tác trong một cửa sổ trong suốt, không viền.',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['máy tính để bàn', 'thú cưng', 'chế độ xem web']
		},
		'zh-TW': {
			name: '桌面寵物',
			avatar: 'https://api.iconify.design/material-symbols/pets.svg',
			description: '將您的角色作為桌面寵物運行。',
			description_markdown: '允許角色在無邊框、透明的窗口中顯示為交互式桌面寵物。',
			version: '0.0.1',
			author: 'Gemini',
			home_page: '',
			tags: ['桌面', '寵物', '網頁視圖']
		}
	},
	/**
	 * 加载Shell。
	 * @param {object} root0 - 参数。
	 * @param {object} root0.router - 路由。
	 * @returns {Promise<void>}
	 */
	Load: async ({ router }) => {
		setEndpoints(router)
	},
	/**
	 * 卸载Shell。
	 * @returns {Promise<void>}
	 */
	Unload: async () => { },

	interfaces: {
		invokes: {
			/**
			 * 参数处理器。
			 * @param {string} user - 用户。
			 * @param {Array<string>} args - 参数。
			 * @returns {Promise<void>}
			 */
			ArgumentsHandler: async (user, args) => {
				const [action, charname] = args
				const params = {
					charname
				}
				const result = await handleAction(user, action, params)
				if (result !== undefined)
					console.log(result)

			},
			/**
			 * IPC调用处理器。
			 * @param {string} user - 用户。
			 * @param {object} data - 数据。
			 * @returns {Promise<any>} - 动作结果。
			 */
			IPCInvokeHandler: async (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			}
		},
		jobs: {
			/**
			 * 重启任务。
			 * @param {string} user - 用户。
			 * @param {string} charname - 角色名称。
			 * @returns {Promise<void>}
			 */
			ReStartJob: async (user, charname) => {
				const { runPet } = await import('./src/pet_runner.mjs')
				await runPet(user, charname)
			}
		}
	}
}
