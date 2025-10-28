import { events } from '../../../server/events.mjs'

import { onPartInstalled, onPartUninstalled } from './src/api.mjs'
import { setEndpoints } from './src/endpoints.mjs'

export default {
	info: {
		'en-UK': {
			name: 'Achievements',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: 'View and manage your achievements.',
			description_markdown: 'A shell to track your progress and milestones within fount.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['achievements', 'gamification', 'profile']
		},
		'zh-CN': {
			name: '成就',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: '查看和管理您的成就。',
			description_markdown: '一个用于跟踪您在fount中的进度和里程碑的shell。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['成就', '游戏化', '个人资料']
		},
		'ar-SA': {
			name: 'إنجاز',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: 'عرض وإدارة إنجازاتك.',
			description_markdown: 'قذيفة لتتبع تقدمك ومعالمك داخل fount.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['الإنجازات', 'التلعيب', 'الملف الشخصي']
		},
		'de-DE': {
			name: 'Leistung',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: 'Anzeigen und Verwalten Ihrer Erfolge.',
			description_markdown: 'Eine Shell, um Ihren Fortschritt und Ihre Meilensteine in fount zu verfolgen.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Erfolge', 'Gamification', 'Profil']
		},
		emoji: {
			name: '🏆',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: 'View and manage your achievements.',
			description_markdown: 'A shell to track your progress and milestones within fount.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['achievements', 'gamification', 'profile']
		},
		'es-ES': {
			name: 'Logro',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: 'Ver y gestionar tus logros.',
			description_markdown: 'Un shell para seguir tu progreso e hitos dentro de fount.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['logros', 'gamificación', 'perfil']
		},
		'fr-FR': {
			name: 'Réalisation',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: 'Visualisez et gérez vos réalisations.',
			description_markdown: 'Un shell pour suivre votre progression et vos jalons dans fount.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['réalisations', 'gamification', 'profil']
		},
		'hi-IN': {
			name: 'उपलब्धि',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: 'अपनी उपलब्धियों को देखें और प्रबंधित करें।',
			description_markdown: 'फाउंट के भीतर अपनी प्रगति और मील के पत्थर को ट्रैक करने के लिए एक शेल।',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['उपलब्धियां', 'गेमिफिकेशन', 'प्रोफ़ाइल']
		},
		'is-IS': {
			name: 'Afrek',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: 'Skoðaðu og stjórnaðu afrekum þínum.',
			description_markdown: 'Skél til að fylgjast með framförum þínum og áföngum innan fount.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['afrek', 'leikjavæðing', 'prófíll']
		},
		'it-IT': {
			name: 'Risultato',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: 'Visualizza e gestisci i tuoi risultati.',
			description_markdown: 'Una shell per tenere traccia dei tuoi progressi e delle tue pietre miliari all\'interno di fount.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['risultati', 'gamification', 'profilo']
		},
		'ja-JP': {
			name: '成果',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: '実績を表示および管理します。',
			description_markdown: 'fount内での進捗とマイルストーンを追跡するためのシェル。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['実績', 'ゲーミフィケーション', 'プロフィール']
		},
		'ko-KR': {
			name: '성취',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: '업적을 보고 관리합니다.',
			description_markdown: 'fount 내에서 진행 상황과 이정표를 추적하는 셸입니다。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['업적', '게임화', '프로필']
		},
		lzh: {
			name: '功绩',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: '查看和管理您的功绩。',
			description_markdown: '一个用于跟踪您在fount中的进度和里程碑的shell。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['功绩', '游戏化', '个人资料']
		},
		'nl-NL': {
			name: 'Prestatie',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: 'Bekijk en beheer uw prestaties.',
			description_markdown: 'Een shell om uw voortgang en mijlpalen binnen fount te volgen.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['prestaties', 'gamificatie', 'profiel']
		},
		'pt-PT': {
			name: 'Conquista',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: 'Veja e gerencie suas conquistas.',
			description_markdown: 'Um shell para acompanhar seu progresso e marcos dentro do fount.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['conquistas', 'gamificação', 'perfil']
		},
		'ru-RU': {
			name: 'Достижение',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: 'Просмотр и управление вашими достижениями.',
			description_markdown: 'Оболочка для отслеживания вашего прогресса и вех в fount.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['достижения', 'геймификация', 'профиль']
		},
		'uk-UA': {
			name: 'досягнення',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: 'Переглядайте та керуйте своїми досягненнями.',
			description_markdown: 'Оболонка для відстеження вашого прогресу та етапів у fount.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['досягнення', 'гейміфікація', 'профіль']
		},
		'vi-VN': {
			name: 'Thành tích',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: 'Xem và quản lý thành tích của bạn.',
			description_markdown: 'Một trình bao để theo dõi tiến trình và các mốc quan trọng của bạn trong fount.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['thành tích', 'trò chơi hóa', 'hồ sơ']
		},
		'zh-TW': {
			name: '成就',
			avatar: 'https://api.iconify.design/material-symbols/trophy.svg',
			description: '查看和管理您的成就。',
			description_markdown: '一個用於跟蹤您在fount中的進度和里程碑的shell。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['成就', '遊戲化', '個人資料']
		}
	},
	Load: ({ router }) => {
		setEndpoints(router)
		events.on('part-installed', onPartInstalled)
		events.on('part-uninstalled', onPartUninstalled)
	},
	Unload: () => {
		events.off('part-installed', onPartInstalled)
		events.off('part-uninstalled', onPartUninstalled)
	},
}
