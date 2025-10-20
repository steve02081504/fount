import { events } from '../../../server/events.mjs'

import { setEndpoints } from './src/endpoints.mjs'
import { onPartInstalled, onPartUninstalled } from './src/home.mjs'

export default {
	info: {
		'en-UK': {
			name: 'Home',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'The home page of Project Fount.',
			description_markdown: 'The central hub for navigating Project Fount, providing access to all shells and features.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['home', 'dashboard', 'main']
		},
		'zh-CN': {
			name: '主页',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'Project Fount 的主页。',
			description_markdown: '用于导航 Project Fount 的中央枢纽，提供对所有shell和功能的访问。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['主页', '仪表板', '主要']
		},
		'ar-SA': {
			name: 'الصفحة الرئيسية',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'الصفحة الرئيسية لمشروع Fount.',
			description_markdown: 'المركز المركزي للتنقل في مشروع Fount، مما يوفر الوصول إلى جميع الأصداف والميزات.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['الصفحة الرئيسية', 'لوحة القيادة', 'الرئيسية']
		},
		'de-DE': {
			name: 'Startseite',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'Die Startseite von Project Fount.',
			description_markdown: 'Der zentrale Hub für die Navigation in Project Fount, der Zugriff auf alle Shells und Funktionen bietet.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Startseite', 'Dashboard', 'Haupt']
		},
		emoji: {
			name: '🏠',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'The home page of Project Fount.',
			description_markdown: 'The central hub for navigating Project Fount, providing access to all shells and features.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['home', 'dashboard', 'main']
		},
		'es-ES': {
			name: 'Página de inicio',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'La página de inicio del Proyecto Fount.',
			description_markdown: 'El centro neurálgico para navegar por Project Fount, que brinda acceso a todos los shells y funciones.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['página de inicio', 'tablero', 'principal']
		},
		'fr-FR': {
			name: 'Page d\'accueil',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'La page d\'accueil du projet Fount.',
			description_markdown: 'Le hub central pour naviguer dans Project Fount, donnant accès à tous les shells et fonctionnalités.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['page d\'accueil', 'tableau de bord', 'principal']
		},
		'hi-IN': {
			name: 'होम पेज',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'प्रोजेक्ट फाउंट का होम पेज।',
			description_markdown: 'प्रोजेक्ट फाउंट को नेविगेट करने का केंद्रीय केंद्र, सभी शेल और सुविधाओं तक पहुंच प्रदान करता है।',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['होम पेज', 'डैशबोर्ड', 'मुख्य']
		},
		'is-IS': {
			name: 'Heim',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'Heimasíða Project Fount.',
			description_markdown: 'Miðstöðin til að fletta um Project Fount, sem veitir aðgang að öllum skeljum og eiginleikum.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['heim', 'mælaborð', 'aðal']
		},
		'it-IT': {
			name: 'Pagina iniziale',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'La home page di Project Fount.',
			description_markdown: 'L\'hub centrale per la navigazione in Project Fount, che fornisce l\'accesso a tutte le shell e le funzionalità.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['pagina iniziale', 'dashboard', 'principale']
		},
		'ja-JP': {
			name: 'ホームページ',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'Project Fountのホームページ。',
			description_markdown: 'Project Fountをナビゲートするための中央ハブで、すべてのシェルと機能にアクセスできます。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ホームページ', 'ダッシュボード', 'メイン']
		},
		'ko-KR': {
			name: '홈페이지',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'Project Fount의 홈페이지입니다.',
			description_markdown: 'Project Fount를 탐색하기 위한 중앙 허브로 모든 셸과 기능에 대한 액세스를 제공합니다.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['홈페이지', '대시보드', '메인']
		},
		lzh: {
			name: '主頁',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'Project Fount 的主頁。',
			description_markdown: '用於導航 Project Fount 的中央樞紐，提供對所有shell和功能的訪問。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['主頁', '儀表板', '主要']
		},
		'nl-NL': {
			name: 'Startpagina',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'De startpagina van Project Fount.',
			description_markdown: 'De centrale hub voor het navigeren door Project Fount, die toegang biedt tot alle shells en functies.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['startpagina', 'dashboard', 'hoofd']
		},
		'pt-PT': {
			name: 'Página inicial',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'A página inicial do Projeto Fount.',
			description_markdown: 'O hub central para navegar no Projeto Fount, fornecendo acesso a todos os shells e recursos.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['página inicial', 'painel', 'principal']
		},
		'ru-RU': {
			name: 'Домашняя страница',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'Домашняя страница Project Fount.',
			description_markdown: 'Центральный узел для навигации по Project Fount, предоставляющий доступ ко всем оболочкам и функциям.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['домашняя страница', 'панель управления', 'главная']
		},
		'uk-UA': {
			name: 'Домашня сторінка',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'Домашня сторінка Project Fount.',
			description_markdown: 'Центральний вузол для навігації по Project Fount, що надає доступ до всіх оболонок і функцій.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['домашня сторінка', 'панель управління', 'головна']
		},
		'vi-VN': {
			name: 'Trang chủ',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'Trang chủ của Dự án Fount.',
			description_markdown: 'Trung tâm điều hướng Dự án Fount, cung cấp quyền truy cập vào tất cả các shell và tính năng.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['trang chủ', 'bảng điều khiển', 'chính']
		},
		'zh-TW': {
			name: '主頁',
			avatar: 'https://api.iconify.design/material-symbols/home.svg',
			description: 'Project Fount 的主頁。',
			description_markdown: '用於導航 Project Fount 的中央樞紐，提供對所有shell和功能的訪問。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['主頁', '儀表板', '主要']
		}
	},
	Load: async ({ router }) => {
		setEndpoints(router)
		events.on('part-installed', onPartInstalled)
		events.on('part-uninstalled', onPartUninstalled)
	},
	Unload: async () => {
		events.off('part-installed', onPartInstalled)
		events.off('part-uninstalled', onPartUninstalled)
	},
}
