/**
 * @description 处理动作。
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

export default {
	info: {
		'en-UK': {
			name: 'Preload',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: 'A shell to preload parts.',
			description_markdown: 'Preloads frequently used components to improve performance and reduce loading times.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['preload', 'system', 'performance']
		},
		'zh-CN': {
			name: '预加载',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: '一个用于预加载部件的shell。',
			description_markdown: '预加载常用组件以提高性能并减少加载时间。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['预加载', '系统', '性能']
		},
		'ar-SA': {
			name: 'تحميل مسبق',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: 'قذيفة لتحميل أجزاء مسبقًا.',
			description_markdown: 'يقوم بتحميل المكونات المستخدمة بشكل متكرر مسبقًا لتحسين الأداء وتقليل أوقات التحميل.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['تحميل مسبق', 'نظام', 'أداء']
		},
		'de-DE': {
			name: 'Vorladen',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: 'Eine Shell zum Vorladen von Teilen.',
			description_markdown: 'Lädt häufig verwendete Komponenten vor, um die Leistung zu verbessern und die Ladezeiten zu verkürzen.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Vorladen', 'System', 'Leistung']
		},
		emoji: {
			name: '⏩',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: 'A shell to preload parts.',
			description_markdown: 'Preloads frequently used components to improve performance and reduce loading times.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['preload', 'system', 'performance']
		},
		'es-ES': {
			name: 'Precargar',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: 'Un shell para precargar piezas.',
			description_markdown: 'Precarga los componentes de uso frecuente para mejorar el rendimiento y reducir los tiempos de carga.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['precargar', 'sistema', 'rendimiento']
		},
		'fr-FR': {
			name: 'Précharger',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: 'Un shell pour précharger des pièces.',
			description_markdown: 'Précharge les composants fréquemment utilisés pour améliorer les performances et réduire les temps de chargement.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['précharger', 'système', 'performance']
		},
		'hi-IN': {
			name: 'प्रीलोड',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: 'भागों को प्रीलोड करने के लिए एक शेल।',
			description_markdown: 'प्रदर्शन में सुधार और लोडिंग समय को कम करने के लिए अक्सर उपयोग किए जाने वाले घटकों को प्रीलोड करता है।',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['प्रीलोड', 'सिस्टम', 'प्रदर्शन']
		},
		'is-IS': {
			name: 'Forhlaða',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: 'Skél til að forhlaða hluta.',
			description_markdown: 'Forhleður oft notaða íhluti til að bæta afköst og draga úr hleðslutíma.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['forhlaða', 'kerfi', 'afköst']
		},
		'it-IT': {
			name: 'Precarica',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: 'Una shell per precaricare le parti.',
			description_markdown: 'Precarica i componenti utilizzati di frequente per migliorare le prestazioni e ridurre i tempi di caricamento.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['precarica', 'sistema', 'prestazioni']
		},
		'ja-JP': {
			name: 'プリロード',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: 'パーツをプリロードするためのシェル。',
			description_markdown: '頻繁に使用されるコンポーネントをプリロードして、パフォーマンスを向上させ、読み込み時間を短縮します。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['プリロード', 'システム', 'パフォーマンス']
		},
		'ko-KR': {
			name: '미리 로드',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: '부품을 미리 로드하는 셸입니다.',
			description_markdown: '자주 사용하는 구성 요소를 미리 로드하여 성능을 개선하고 로드 시간을 줄입니다.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['미리 로드', '시스템', '성능']
		},
		lzh: {
			name: '預載',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: '一個用於預載部件的shell。',
			description_markdown: '預載常用組件以提高性能並減少加載時間。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['預載', '系統', '性能']
		},
		'nl-NL': {
			name: 'Vooraf laden',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: 'Een shell om onderdelen vooraf te laden.',
			description_markdown: 'Laadt veelgebruikte componenten vooraf om de prestaties te verbeteren en de laadtijden te verkorten.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['vooraf laden', 'systeem', 'prestaties']
		},
		'pt-PT': {
			name: 'Pré-carregar',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: 'Um shell para pré-carregar peças.',
			description_markdown: 'Pré-carrega componentes usados com frequência para melhorar o desempenho e reduzir os tempos de carregamento.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['pré-carregar', 'sistema', 'desempenho']
		},
		'ru-RU': {
			name: 'Предварительная загрузка',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: 'Оболочка для предварительной загрузки деталей.',
			description_markdown: 'Предварительно загружает часто используемые компоненты для повышения производительности и сокращения времени загрузки.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['предварительная загрузка', 'система', 'производительность']
		},
		'uk-UA': {
			name: 'Попереднє завантаження',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: 'Оболонка для попереднього завантаження деталей.',
			description_markdown: 'Попередньо завантажує часто використовувані компоненти для підвищення продуктивності та скорочення часу завантаження.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['попереднє завантаження', 'система', 'продуктивність']
		},
		'vi-VN': {
			name: 'Tải trước',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: 'Một trình bao để tải trước các bộ phận.',
			description_markdown: 'Tải trước các thành phần thường được sử dụng để cải thiện hiệu suất và giảm thời gian tải.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['tải trước', 'hệ thống', 'hiệu suất']
		},
		'zh-TW': {
			name: '預載',
			avatar: 'https://api.iconify.design/material-symbols/play-for-work.svg',
			description: '一個用於預載部件的shell。',
			description_markdown: '預載常用組件以提高性能並減少加載時間。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['預載', '系統', '性能']
		}
	},
	Load: ({ router }) => { },
	Unload: ({ router }) => { },

	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				await handleAction(user, 'default', { parttype: args[0], partname: args[1] })
			},
			IPCInvokeHandler: async (user, data) => {
				await handleAction(user, 'default', data)
			}
		}
	}
}
