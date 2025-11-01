import { setEndpoints } from './src/endpoints.mjs'

/**
 * @description 浏览器集成Shell
 */
export default {
	info: {
		'en-UK': {
			name: 'Browser Integration',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: 'Userscript for enhanced browser interaction.',
			description_markdown: 'Provides a userscript to allow characters to interact with the browser page content more natively.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['userscript', 'browser', 'integration']
		},
		'zh-CN': {
			name: '浏览器集成',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: '用于增强浏览器交互的用户脚本。',
			description_markdown: '提供一个用户脚本，允许角色更自然地与浏览器页面内容进行交互。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['用户脚本', '浏览器', '集成']
		},
		'ar-SA': {
			name: 'تكامل المتصفح',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: 'Userscript لتفاعل المتصفح المحسن.',
			description_markdown: 'يوفر userscript للسماح للشخصيات بالتفاعل مع محتوى صفحة المتصفح بشكل أكثر أصالة.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['userscript', 'المتصفح', 'التكامل']
		},
		'de-DE': {
			name: 'Browser-Integration',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: 'Userscript für eine verbesserte Browser-Interaktion.',
			description_markdown: 'Stellt ein Userscript bereit, mit dem Charaktere nativer mit dem Inhalt der Browserseite interagieren können.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Userscript', 'Browser', 'Integration']
		},
		emoji: {
			name: '🌀📍',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: 'Userscript for enhanced browser interaction.',
			description_markdown: 'Provides a userscript to allow characters to interact with the browser page content more natively.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['userscript', 'browser', 'integration']
		},
		'es-ES': {
			name: 'Integración del navegador',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: 'Userscript para una interacción mejorada del navegador.',
			description_markdown: 'Proporciona un userscript para permitir que los personajes interactúen con el contenido de la página del navegador de forma más nativa.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['userscript', 'navegador', 'integración']
		},
		'fr-FR': {
			name: 'Intégration du navigateur',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: 'Userscript pour une interaction améliorée avec le navigateur.',
			description_markdown: 'Fournit un userscript pour permettre aux personnages d\'interagir plus nativement avec le contenu de la page du navigateur.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['userscript', 'navigateur', 'intégration']
		},
		'hi-IN': {
			name: 'ब्राउज़र एकीकरण',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: 'उन्नत ब्राउज़र इंटरैक्शन के लिए यूजरस्क्रिप्ट।',
			description_markdown: 'पात्रों को ब्राउज़र पृष्ठ सामग्री के साथ अधिक मूल रूप से बातचीत करने की अनुमति देने के लिए एक यूजरस्क्रिप्ट प्रदान करता है।',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['यूजरस्क्रिप्ट', 'ब्राउज़र', 'एकीकरण']
		},
		'is-IS': {
			name: 'Samþætting vafra',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: 'Notandaskrifta fyrir aukna vafravirkni.',
			description_markdown: 'Býður upp á notendaskriftu til að leyfa persónum að hafa samskipti við innihald vafra síðunnar á eðlilegri hátt.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['notendaskrifta', 'vafra', 'samþætting']
		},
		'it-IT': {
			name: 'Integrazione del browser',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: 'Userscript per un\'interazione avanzata del browser.',
			description_markdown: 'Fornisce un userscript per consentire ai personaggi di interagire in modo più nativo con il contenuto della pagina del browser.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['userscript', 'browser', 'integrazione']
		},
		'ja-JP': {
			name: 'ブラウザ統合',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: 'ブラウザの操作性を向上させるためのユーザースクリプト。',
			description_markdown: 'キャラクターがブラウザのページコンテンツとよりネイティブに対話できるようにするユーザースクリプトを提供します。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['ユーザースクリプト', 'ブラウザ', '統合']
		},
		'ko-KR': {
			name: '브라우저 통합',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: '향상된 브라우저 상호 작용을 위한 사용자 스크립트입니다.',
			description_markdown: '캐릭터가 브라우저 페이지 콘텐츠와 보다 자연스럽게 상호 작용할 수 있도록 하는 사용자 스크립트를 제공합니다.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['사용자 스크립트', '브라우저', '통합']
		},
		lzh: {
			name: '覽器統合',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: '用於增強瀏覽器交互的用戶腳本。',
			description_markdown: '提供一個用戶腳本，允許角色更自然地與瀏覽器頁面內容進行交互。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['用戶腳本', '瀏覽器', '集成']
		},
		'nl-NL': {
			name: 'Browserintegratie',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: 'Userscript voor verbeterde browserinteractie.',
			description_markdown: 'Biedt een userscript waarmee personages op een meer native manier kunnen communiceren met de inhoud van de browserpagina.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['userscript', 'browser', 'integratie']
		},
		'pt-PT': {
			name: 'Integração do navegador',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: 'Userscript para interação aprimorada do navegador.',
			description_markdown: 'Fornece um userscript para permitir que os personagens interajam com o conteúdo da página do navegador de forma mais nativa.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['userscript', 'navegador', 'integração']
		},
		'ru-RU': {
			name: 'Интеграция с браузером',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: 'Пользовательский скрипт для расширенного взаимодействия с браузером.',
			description_markdown: 'Предоставляет пользовательский скрипт, позволяющий персонажам более нативно взаимодействовать с содержимым страницы браузера.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['пользовательский скрипт', 'браузер', 'интеграция']
		},
		'uk-UA': {
			name: 'Інтеграція з браузером',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: 'Користувацький скрипт для розширеної взаємодії з браузером.',
			description_markdown: 'Надає користувацький скрипт, що дозволяє персонажам більш нативно взаємодіяти з вмістом сторінки браузера.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['користувацький скрипт', 'браузер', 'інтеграція']
		},
		'vi-VN': {
			name: 'Tích hợp trình duyệt',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: 'Userscript để tăng cường tương tác với trình duyệt.',
			description_markdown: 'Cung cấp một userscript để cho phép các nhân vật tương tác với nội dung trang trình duyệt một cách tự nhiên hơn.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['userscript', 'trình duyệt', 'tích hợp']
		},
		'zh-TW': {
			name: '瀏覽器整合',
			avatar: 'https://api.iconify.design/line-md/cookie.svg',
			description: '用於增強瀏覽器互動的使用者腳本。',
			description_markdown: '提供一個使用者腳本，允許角色更自然地與瀏覽器頁面內容進行互動。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['使用者腳本', '瀏覽器', '整合']
		}
	},
	/**
	 * @description 加载Shell。
	 * @param {object} root0 - 参数。
	 * @param {object} root0.router - 路由。
	 */
	Load: ({ router }) => {
		setEndpoints(router)
	}
}
