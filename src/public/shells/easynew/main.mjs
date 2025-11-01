import { setEndpoints } from './src/main.mjs'

/**
 * 处理传入的快速新建动作请求。
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

/** @type {import('../../../decl/shellAPI.ts').ShellAPI_t} */
export default {
	info: {
		'en-UK': {
			name: 'Quick Create',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: 'Easily create new parts from templates.',
			description_markdown: 'A streamlined tool for quickly generating new characters, personas, or worlds from predefined templates.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['tool', 'creator', 'template']
		},
		'zh-CN': {
			name: '快速新建',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: '从模板轻松创建新部件。',
			description_markdown: '一个简化的工具，用于从预定义的模板快速生成新的角色、角色或世界。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['工具', '创造者', '模板']
		},
		'ar-SA': {
			name: 'إنشاء سريع',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: 'إنشاء أجزاء جديدة بسهولة من القوالب.',
			description_markdown: 'أداة مبسطة لإنشاء شخصيات أو شخصيات أو عوالم جديدة بسرعة من قوالب محددة مسبقًا.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['أداة', 'منشئ', 'قالب']
		},
		'de-DE': {
			name: 'Schnellerstellung',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: 'Erstellen Sie einfach neue Teile aus Vorlagen.',
			description_markdown: 'Ein optimiertes Tool zum schnellen Generieren neuer Charaktere, Personas oder Welten aus vordefinierten Vorlagen.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Werkzeug', 'Ersteller', 'Vorlage']
		},
		emoji: {
			name: '✨🆕',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: 'Easily create new parts from templates.',
			description_markdown: 'A streamlined tool for quickly generating new characters, personas, or worlds from predefined templates.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['tool', 'creator', 'template']
		},
		'es-ES': {
			name: 'Creación rápida',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: 'Cree fácilmente nuevas piezas a partir de plantillas.',
			description_markdown: 'Una herramienta optimizada para generar rápidamente nuevos personajes, personas o mundos a partir de plantillas predefinidas.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['herramienta', 'creador', 'plantilla']
		},
		'fr-FR': {
			name: 'Création rapide',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: 'Créez facilement de nouvelles pièces à partir de modèles.',
			description_markdown: 'Un outil simplifié pour générer rapidement de nouveaux personnages, personas ou mondes à partir de modèles prédéfinis.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['outil', 'créateur', 'modèle']
		},
		'hi-IN': {
			name: 'त्वरित निर्माण',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: 'टेम्पलेट्स से आसानी से नए हिस्से बनाएं।',
			description_markdown: 'पूर्वनिर्धारित टेम्पलेट्स से नए वर्ण, व्यक्ति या दुनिया को जल्दी से उत्पन्न करने के लिए एक सुव्यवस्थित उपकरण।',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['उपकरण', 'निर्माता', 'टेम्पलेट']
		},
		'is-IS': {
			name: 'Flýtigerð',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: 'Búðu auðveldlega til nýja hluta úr sniðmátum.',
			description_markdown: 'Straumlínulagað tól til að búa fljótt til nýjar persónur, persónur eða heima úr fyrirfram skilgreindum sniðmátum.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['tól', 'höfundur', 'sniðmát']
		},
		'it-IT': {
			name: 'Creazione rapida',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: 'Crea facilmente nuove parti dai modelli.',
			description_markdown: 'Uno strumento semplificato per generare rapidamente nuovi personaggi, personaggi o mondi da modelli predefiniti.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['strumento', 'creatore', 'modello']
		},
		'ja-JP': {
			name: 'クイック作成',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: 'テンプレートから新しいパーツを簡単に作成します。',
			description_markdown: '事前に定義されたテンプレートから新しいキャラクター、ペルソナ、またはワールドをすばやく生成するための合理化されたツール。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ツール', '作成者', 'テンプレート']
		},
		'ko-KR': {
			name: '빠른 생성',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: '템플릿에서 새 부품을 쉽게 만듭니다.',
			description_markdown: '미리 정의된 템플릿에서 새 캐릭터, 페르소나 또는 세계를 빠르게 생성하기 위한 간소화된 도구입니다.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['도구', '작성자', '템플릿']
		},
		lzh: {
			name: '速建',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: '從範本輕鬆建立新組件。',
			description_markdown: '一種簡化的工具，可從預定義的範本快速生成新的角色、角色或世界。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['工具', '創建者', '範本']
		},
		'nl-NL': {
			name: 'Bouw snel nieuw',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: 'Maak eenvoudig nieuwe onderdelen van sjablonen.',
			description_markdown: 'Een gestroomlijnde tool voor het snel genereren van nieuwe personages, persona\'s of werelden op basis van vooraf gedefinieerde sjablonen.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['gereedschap', 'maker', 'sjabloon']
		},
		'pt-PT': {
			name: 'Criação Rápida',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: 'Crie facilmente novas peças a partir de modelos.',
			description_markdown: 'Uma ferramenta simplificada para gerar rapidamente novos personagens, personas ou mundos a partir de modelos predefinidos.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ferramenta', 'criador', 'modelo']
		},
		'ru-RU': {
			name: 'Быстрое создание',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: 'Легко создавайте новые детали из шаблонов.',
			description_markdown: 'Оптимизированный инструмент для быстрого создания новых персонажей, персонажей или миров из предопределенных шаблонов.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['инструмент', 'создатель', 'шаблон']
		},
		'uk-UA': {
			name: 'Швидко побудувати нове',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: 'Легко створюйте нові деталі з шаблонів.',
			description_markdown: 'Спрощений інструмент для швидкого створення нових персонажів, персон або світів із попередньо визначених шаблонів.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['інструмент', 'творець', 'шаблон']
		},
		'vi-VN': {
			name: 'Tạo nhanh',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: 'Dễ dàng tạo các bộ phận mới từ các mẫu.',
			description_markdown: 'Một công cụ được sắp xếp hợp lý để nhanh chóng tạo ra các nhân vật, nhân vật hoặc thế giới mới từ các mẫu được xác định trước.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['công cụ', 'người tạo', 'mẫu']
		},
		'zh-TW': {
			name: '快速新建',
			avatar: 'https://api.iconify.design/material-symbols/add-circle-outline.svg',
			description: '從範本輕鬆建立新組件。',
			description_markdown: '一種簡化的工具，可從預定義的範本快速生成新的角色、角色或世界。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['工具', '創建者', '範本']
		}
	},

	/**
	 * 加载快速新建Shell并设置API端点。
	 * @param {object} root0 - 参数对象。
	 * @param {object} root0.router - Express的路由实例。
	 * @returns {Promise<void>}
	 */
	Load: async ({ router }) => {
		setEndpoints(router)
	},

	interfaces: {
		invokes: {
			/**
			 * 处理命令行参数以执行快速新建操作。
			 * @param {string} user - 用户名。
			 * @param {Array<string>} args - 命令行参数数组。
			 * @returns {Promise<void>}
			 */
			ArgumentsHandler: async (user, args) => {
				const [action, templateName, partName, jsonData] = args
				const params = {
					templateName,
					partName,
					jsonData: jsonData ? JSON.parse(jsonData) : {}
				}
				const result = await handleAction(user, action, params)
				if (result !== undefined)
					console.log(result)

			},
			/**
			 * 处理IPC调用以执行快速新建操作。
			 * @param {string} user - 用户名。
			 * @param {object} data - 从IPC接收的数据对象。
			 * @returns {Promise<any>} - 动作执行结果。
			 */
			IPCInvokeHandler: async (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			}
		}
	}
}
