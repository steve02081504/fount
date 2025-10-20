async function handleAction(user, action, params) {
	const { actions } = await import('./src/actions.mjs')
	if (!actions[action])
		throw new Error(`Unknown action: ${action}. Available actions: ${Object.keys(actions).join(', ')}`)

	return actions[action]({ user, ...params })
}

export default {
	info: {
		'en-UK': {
			name: 'Access on other devices',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: 'Access Fount from other devices on the same network.',
			description_markdown: 'This shell provides a URL and QR code to access Fount from other devices on the same local network.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['network', 'remote', 'access']
		},
		'zh-CN': {
			name: '在其他设备访问',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: '在同一网络下的其他设备上访问Fount。',
			description_markdown: '此shell提供一个URL和二维码，以便在同一本地网络上的其他设备上访问Fount。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['网络', '远程', '访问']
		},
		'ar-SA': {
			name: 'الوصول من أجهزة أخرى',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: 'الوصول إلى Fount من الأجهزة الأخرى على نفس الشبكة.',
			description_markdown: 'يوفر هذا shell عنوان URL ورمز QR للوصول إلى Fount من الأجهزة الأخرى على نفس الشبكة المحلية.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['الشبكة', 'عن بعد', 'الوصول']
		},
		'de-DE': {
			name: 'Zugriff auf anderen Geräten',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: 'Greifen Sie von anderen Geräten im selben Netzwerk auf Fount zu.',
			description_markdown: 'Diese Shell bietet eine URL und einen QR-Code für den Zugriff auf Fount von anderen Geräten im selben lokalen Netzwerk.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['Netzwerk', 'Fernbedienung', 'Zugriff']
		},
		emoji: {
			name: '💻📱➡️⛲',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: 'Access Fount from other devices on the same network.',
			description_markdown: 'This shell provides a URL and QR code to access Fount from other devices on the same local network.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['network', 'remote', 'access']
		},
		'es-ES': {
			name: 'Acceso en otros dispositivos',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: 'Acceda a Fount desde otros dispositivos en la misma red.',
			description_markdown: 'Este shell proporciona una URL y un código QR para acceder a Fount desde otros dispositivos en la misma red local.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['red', 'remoto', 'acceso']
		},
		'fr-FR': {
			name: 'Accès sur d\'autres appareils',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: 'Accédez à Fount depuis d\'autres appareils sur le même réseau.',
			description_markdown: 'Ce shell fournit une URL et un code QR pour accéder à Fount depuis d\'autres appareils sur le même réseau local.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['réseau', 'à distance', 'accès']
		},
		'hi-IN': {
			name: 'अन्य डिवाइस पर पहुँचें',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: 'एक ही नेटवर्क पर अन्य उपकरणों से फाउंट तक पहुंचें।',
			description_markdown: 'यह शेल एक ही स्थानीय नेटवर्क पर अन्य उपकरणों से फाउंट तक पहुंचने के लिए एक यूआरएल और क्यूआर कोड प्रदान करता है।',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['नेटवर्क', 'रिमोट', 'पहुंच']
		},
		'is-IS': {
			name: 'Aðgangur að öðrum tækjum',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: 'Aðgangur að Fount frá öðrum tækjum á sama neti.',
			description_markdown: 'Þessi skel veitir vefslóð og QR kóða til að fá aðgang að Fount frá öðrum tækjum á sama staðarneti.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['net', 'fjarlægur', 'aðgangur']
		},
		'it-IT': {
			name: 'Accesso su altri dispositivi',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: 'Accedi a Fount da altri dispositivi sulla stessa rete.',
			description_markdown: 'Questa shell fornisce un URL e un codice QR per accedere a Fount da altri dispositivi sulla stessa rete locale.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['rete', 'remoto', 'accesso']
		},
		'ja-JP': {
			name: '他のデバイスへのアクセス',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: '同じネットワーク上の他のデバイスからFountにアクセスします。',
			description_markdown: 'このシェルは、同じローカルネットワーク上の他のデバイスからFountにアクセスするためのURLとQRコードを提供します。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['ネットワーク', 'リモート', 'アクセス']
		},
		'ko-KR': {
			name: '다른 디바이스에서 접속',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: '동일한 네트워크의 다른 장치에서 Fount에 액세스하십시오.',
			description_markdown: '이 셸은 동일한 로컬 네트워크의 다른 장치에서 Fount에 액세스하기 위한 URL 및 QR 코드를 제공합니다.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['네트워크', '원격', '액세스']
		},
		lzh: {
			name: '從他器訪問',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: '從同一網絡上的其他設備訪問Fount。',
			description_markdown: '此shell提供一個URL和二維碼，以便在同一本地網絡上的其他設備上訪問Fount。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['網絡', '遠程', '訪問']
		},
		'nl-NL': {
			name: 'Toegang op andere apparaten',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: 'Toegang tot Fount vanaf andere apparaten op hetzelfde netwerk.',
			description_markdown: 'Deze shell biedt een URL en QR-code om toegang te krijgen tot Fount vanaf andere apparaten op hetzelfde lokale netwerk.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['netwerk', 'extern', 'toegang']
		},
		'pt-PT': {
			name: 'Acesso em outros dispositivos',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: 'Aceda à Fount a partir de outros dispositivos na mesma rede.',
			description_markdown: 'Este shell fornece um URL e um código QR para aceder à Fount a partir de outros dispositivos na mesma rede local.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['rede', 'remoto', 'acesso']
		},
		'ru-RU': {
			name: 'Доступ на других устройствах',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: 'Доступ к Fount с других устройств в той же сети.',
			description_markdown: 'Эта оболочка предоставляет URL-адрес и QR-код для доступа к Fount с других устройств в той же локальной сети.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['сеть', 'удаленный', 'доступ']
		},
		'uk-UA': {
			name: 'Доступ на інші пристрої',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: 'Доступ до Fount з інших пристроїв у тій самій мережі.',
			description_markdown: 'Ця оболонка надає URL-адресу та QR-код для доступу до Fount з інших пристроїв у тій самій локальній мережі.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['мережа', 'віддалений', 'доступ']
		},
		'vi-VN': {
			name: 'Truy cập trên thiết bị khác',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: 'Truy cập Fount từ các thiết bị khác trên cùng một mạng.',
			description_markdown: 'Shell này cung cấp một URL và mã QR để truy cập Fount từ các thiết bị khác trên cùng một mạng cục bộ.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['mạng', 'từ xa', 'truy cập']
		},
		'zh-TW': {
			name: '在其他設備訪問',
			avatar: 'https://api.iconify.design/line-md/cloud-alt-twotone.svg',
			description: '在同一網路下的其他設備上訪問Fount。',
			description_markdown: '此shell提供一個URL和二維碼，以便在同一本地網絡上的其他設備上訪問Fount。',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
			tags: ['網路', '遠端', '訪問']
		}
	},
	Load: async ({ router }) => { },
	Unload: async () => { },
	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const url = await handleAction(user, 'default', {})
				console.log(`Access fount on other devices in the same network via: ${url}`)
				const qrcode = await import('npm:qrcode-terminal')
				qrcode.generate(url, { small: true })
			},
			IPCInvokeHandler: async (user, args) => {
				return handleAction(user, 'default', args)
			}
		}
	}
}
