import qrcode from 'npm:qrcode-terminal'

import { actions } from './src/actions.mjs'
import { setEndpoints } from './src/endpoints.mjs'

async function handleAction(user, params) {
	return actions.default({ user, ...params })
}

export default {
	info: {
		'en-UK': {
			name: 'Proxy',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: 'A shell to provide OpenAI-compatible API.',
			description_markdown: 'Provides an OpenAI-compatible API endpoint, allowing you to use Project Fount with third-party applications.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['proxy', 'API', 'OpenAI', 'integration']
		},
		'zh-CN': {
			name: '代理',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: '一个提供 OpenAI 兼容 API 的 shell。',
			description_markdown: '提供与 OpenAI 兼容的 API 端点，允许您将 Project Fount 与第三方应用程序一起使用。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['代理', 'API', 'OpenAI', '集成']
		},
		'ar-SA': {
			name: 'وكيل',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: 'قذيفة لتوفير واجهة برمجة تطبيقات متوافقة مع OpenAI.',
			description_markdown: 'يوفر نقطة نهاية API متوافقة مع OpenAI، مما يسمح لك باستخدام Project Fount مع تطبيقات الطرف الثالث.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['وكيل', 'API', 'OpenAI', 'تكامل']
		},
		'de-DE': {
			name: 'Proxy',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: 'Eine Shell zur Bereitstellung einer OpenAI-kompatiblen API.',
			description_markdown: 'Bietet einen OpenAI-kompatiblen API-Endpunkt, mit dem Sie Project Fount mit Anwendungen von Drittanbietern verwenden können.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Proxy', 'API', 'OpenAI', 'Integration']
		},
		emoji: {
			name: '🤖🔄',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: 'A shell to provide OpenAI-compatible API.',
			description_markdown: 'Provides an OpenAI-compatible API endpoint, allowing you to use Project Fount with third-party applications.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['proxy', 'API', 'OpenAI', 'integration']
		},
		'es-ES': {
			name: 'Proxy',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: 'Un shell para proporcionar una API compatible con OpenAI.',
			description_markdown: 'Proporciona un punto final de API compatible con OpenAI, lo que le permite usar Project Fount con aplicaciones de terceros.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['proxy', 'API', 'OpenAI', 'integración']
		},
		'fr-FR': {
			name: 'Proxy',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: 'Un shell pour fournir une API compatible OpenAI.',
			description_markdown: 'Fournit un point de terminaison d\'API compatible OpenAI, vous permettant d\'utiliser Project Fount avec des applications tierces.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['proxy', 'API', 'OpenAI', 'intégration']
		},
		'hi-IN': {
			name: 'प्रॉक्सी',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: 'OpenAI-संगत API प्रदान करने के लिए एक शेल।',
			description_markdown: 'एक OpenAI-संगत API समापन बिंदु प्रदान करता है, जिससे आप तृतीय-पक्ष एप्लिकेशन के साथ प्रोजेक्ट फाउंट का उपयोग कर सकते हैं।',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['प्रॉक्सी', 'API', 'OpenAI', 'एकीकरण']
		},
		'is-IS': {
			name: 'Umboðsmaður',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: 'Skél til að veita OpenAI-samhæft API.',
			description_markdown: 'Veitir OpenAI-samhæfan API endapunkt, sem gerir þér kleift að nota Project Fount með forritum frá þriðja aðila.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['umboðsmaður', 'API', 'OpenAI', 'samþætting']
		},
		'it-IT': {
			name: 'Proxy',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: 'Una shell per fornire un\'API compatibile con OpenAI.',
			description_markdown: 'Fornisce un endpoint API compatibile con OpenAI, che consente di utilizzare Project Fount con applicazioni di terze parti.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['proxy', 'API', 'OpenAI', 'integrazione']
		},
		'ja-JP': {
			name: 'プロキシ',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: 'OpenAI互換のAPIを提供するためのシェル。',
			description_markdown: 'OpenAI互換のAPIエンドポイントを提供し、サードパーティのアプリケーションでProject Fountを使用できるようにします。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['プロキシ', 'API', 'OpenAI', '統合']
		},
		'ko-KR': {
			name: '프록시',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: 'OpenAI 호환 API를 제공하는 셸입니다.',
			description_markdown: 'OpenAI 호환 API 엔드포인트를 제공하여 타사 애플리케이션과 함께 Project Fount를 사용할 수 있습니다.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['프록시', 'API', 'OpenAI', '통합']
		},
		lzh: {
			name: 'API中介',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: '一個提供 OpenAI 兼容 API 的 shell。',
			description_markdown: '提供與 OpenAI 兼容的 API 端點，允許您將 Project Fount 與第三方應用程序一起使用。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['API中介', 'API', 'OpenAI', '集成']
		},
		'nl-NL': {
			name: 'Proxy',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: 'Een shell om een OpenAI-compatibele API te bieden.',
			description_markdown: 'Biedt een OpenAI-compatibel API-eindpunt, zodat u Project Fount kunt gebruiken met toepassingen van derden.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['proxy', 'API', 'OpenAI', 'integratie']
		},
		'pt-PT': {
			name: 'Proxy',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: 'Um shell para fornecer uma API compatível com OpenAI.',
			description_markdown: 'Fornece um ponto de extremidade de API compatível com OpenAI, permitindo que você use o Project Fount com aplicativos de terceiros.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['proxy', 'API', 'OpenAI', 'integração']
		},
		'ru-RU': {
			name: 'Прокси',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: 'Оболочка для предоставления OpenAI-совместимого API.',
			description_markdown: 'Предоставляет OpenAI-совместимую конечную точку API, позволяющую использовать Project Fount со сторонними приложениями.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['прокси', 'API', 'OpenAI', 'интеграция']
		},
		'uk-UA': {
			name: 'Проксі',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: 'Оболонка для надання OpenAI-сумісного API.',
			description_markdown: 'Надає OpenAI-сумісну кінцеву точку API, що дозволяє використовувати Project Fount зі сторонніми додатками.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['проксі', 'API', 'OpenAI', 'інтеграція']
		},
		'vi-VN': {
			name: 'Proxy',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: 'Một trình bao để cung cấp API tương thích với OpenAI.',
			description_markdown: 'Cung cấp một điểm cuối API tương thích với OpenAI, cho phép bạn sử dụng Project Fount với các ứng dụng của bên thứ ba.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['proxy', 'API', 'OpenAI', 'tích hợp']
		},
		'zh-TW': {
			name: '代理',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-braces.svg',
			description: '一個提供 OpenAI 兼容 API 的 shell。',
			description_markdown: '提供與 OpenAI 兼容的 API 端點，允許您將 Project Fount 與第三方應用程序一起使用。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['代理', 'API', 'OpenAI', '集成']
		}
	},
	Load: ({ router }) => {
		setEndpoints(router)
	},
	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const url = await handleAction(user, {})
				const webUI = new URL('/shells/proxy', url).href
				console.log(`Your OpenAI-compatible API endpoint is: ${url}`)
				console.log(`Please go to ${webUI} to generate an API key.`)
				qrcode.generate(webUI, { small: true })
				console.log(`You can use it with any OpenAI-compatible client, for example, to list models, run: curl ${url}/v1/models -H "Authorization: Bearer <your_fount_apikey>"`)
			},
			IPCInvokeHandler: async (user, args) => {
				return handleAction(user, args)
			}
		}
	}
}
