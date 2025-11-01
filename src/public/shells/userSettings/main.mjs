import { setEndpoints } from './src/endpoints.mjs'

/** @typedef {import('../../../decl/basedefs.ts').info_t} info_t */

/**
 * 用户设置 shell 的入口点。
 */

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
 * 用户设置 shell。
 */
export default {
	/**
	 * Shell 的信息。
	 * @type {info_t}
	 */
	info: {
		'en-UK': {
			name: 'User Settings',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: 'Manage user account settings, such as password, username, and API keys.',
			description_markdown: 'Allows users to manage their account settings, including changing passwords, renaming their account, and managing API keys for integrations.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['user', 'settings', 'account', 'profile']
		},
		'zh-CN': {
			name: '用户设置',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: '管理用户帐户设置，例如密码、用户名和 API 密钥。',
			description_markdown: '允许用户管理其帐户设置，包括更改密码、重命名帐户以及管理用于集成的 API 密钥。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['用户', '设置', '帐户', '个人资料']
		},
		'ar-SA': {
			name: 'إعدادات المستخدم',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: 'إدارة إعدادات حساب المستخدم، مثل كلمة المرور واسم المستخدم ومفاتيح API.',
			description_markdown: 'يسمح للمستخدمين بإدارة إعدادات حساباتهم، بما في ذلك تغيير كلمات المرور وإعادة تسمية حساباتهم وإدارة مفاتيح API لعمليات التكامل.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['المستخدم', 'الإعدادات', 'الحساب', 'الملف الشخصي']
		},
		'de-DE': {
			name: 'Benutzereinstellungen',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: 'Verwalten Sie die Einstellungen des Benutzerkontos, wie z. B. Passwort, Benutzername und API-Schlüssel.',
			description_markdown: 'Ermöglicht Benutzern die Verwaltung ihrer Kontoeinstellungen, einschließlich der Änderung von Passwörtern, der Umbenennung ihres Kontos und der Verwaltung von API-Schlüsseln für Integrationen.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Benutzer', 'Einstellungen', 'Konto', 'Profil']
		},
		emoji: {
			name: '👤⚙️',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: 'Manage user account settings, such as password, username, and API keys.',
			description_markdown: 'Allows users to manage their account settings, including changing passwords, renaming their account, and managing API keys for integrations.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['user', 'settings', 'account', 'profile']
		},
		'es-ES': {
			name: 'Configuración de usuario',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: 'Administre la configuración de la cuenta de usuario, como la contraseña, el nombre de usuario y las claves de API.',
			description_markdown: 'Permite a los usuarios administrar la configuración de su cuenta, incluido el cambio de contraseñas, el cambio de nombre de su cuenta y la administración de claves de API para integraciones.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['usuario', 'configuración', 'cuenta', 'perfil']
		},
		'fr-FR': {
			name: 'Paramètres utilisateur',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: 'Gérer les paramètres du compte utilisateur, tels que le mot de passe, le nom d\'utilisateur et les clés API.',
			description_markdown: 'Permet aux utilisateurs de gérer les paramètres de leur compte, notamment en modifiant les mots de passe, en renommant leur compte et en gérant les clés API pour les intégrations.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['utilisateur', 'paramètres', 'compte', 'profil']
		},
		'hi-IN': {
			name: 'उपयोगकर्ता सेटिंग्स',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: 'उपयोगकर्ता खाता सेटिंग्स प्रबंधित करें, जैसे पासवर्ड, उपयोगकर्ता नाम और एपीआई कुंजी।',
			description_markdown: 'उपयोगकर्ताओं को पासवर्ड बदलने, अपने खाते का नाम बदलने और एकीकरण के लिए एपीआई कुंजी प्रबंधित करने सहित अपनी खाता सेटिंग्स प्रबंधित करने की अनुमति देता है।',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['उपयोगकर्ता', 'सेटिंग्स', 'खाता', 'प्रोफ़ाइल']
		},
		'is-IS': {
			name: 'Notendastillingar',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: 'Hafa umsjón með stillingum notandareiknings, svo sem lykilorði, notandanafni og API lyklum.',
			description_markdown: 'Gerir notendum kleift að hafa umsjón með reikningsstillingum sínum, þar á meðal að breyta lykilorðum, endurnefna reikninginn sinn og hafa umsjón með API lyklum fyrir samþættingar.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['notandi', 'stillingar', 'reikningur', 'prófíll']
		},
		'it-IT': {
			name: 'Impostazioni utente',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: 'Gestire le impostazioni dell\'account utente, come password, nome utente e chiavi API.',
			description_markdown: 'Consente agli utenti di gestire le impostazioni del proprio account, inclusa la modifica delle password, la ridenominazione del proprio account e la gestione delle chiavi API for le integrazioni.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['utente', 'impostazioni', 'account', 'profilo']
		},
		'ja-JP': {
			name: 'ユーザー設定',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: 'パスワード、ユーザー名、APIキーなどのユーザーアカウント設定を管理します。',
			description_markdown: 'ユーザーは、パスワードの変更、アカウントの名前変更、統合用のAPIキーの管理など、アカウント設定を管理できます。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ユーザー', '設定', 'アカウント', 'プロファイル']
		},
		'ko-KR': {
			name: '사용자 설정',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: '비밀번호, 사용자 이름, API 키 등 사용자 계정 설정을 관리합니다.',
			description_markdown: '사용자가 비밀번호 변경, 계정 이름 변경, 통합을 위한 API 키 관리 등 계정 설정을 관리할 수 있습니다.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['사용자', '설정', '계정', '프로필']
		},
		lzh: {
			name: '用者規度',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: '管理用戶帳戶規度，例如密碼、用戶名和 API 密鑰。',
			description_markdown: '允許用戶管理其帳戶規度，包括更改密碼、重命名帳戶以及管理用於集成的 API 密鑰。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['用者', '規度', '帳戶', '個人資料']
		},
		'nl-NL': {
			name: 'Gebruikersinstellingen',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: 'Beheer de instellingen van het gebruikersaccount, zoals wachtwoord, gebruikersnaam en API-sleutels.',
			description_markdown: 'Hiermee kunnen gebruikers hun accountinstellingen beheren, waaronder het wijzigen van wachtwoorden, het hernoemen van hun account en het beheren van API-sleutels voor integraties.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['gebruiker', 'instellingen', 'account', 'profiel']
		},
		'pt-PT': {
			name: 'Configurações do usuário',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: 'Gerencie as configurações da conta do usuário, como senha, nome de usuário e chaves de API.',
			description_markdown: 'Permite que os usuários gerenciem as configurações de suas contas, incluindo a alteração de senhas, a renomeação de suas contas e o gerenciamento de chaves de API para integrações.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['usuário', 'configurações', 'conta', 'perfil']
		},
		'ru-RU': {
			name: 'Настройки пользователя',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: 'Управление настройками учетной записи пользователя, такими как пароль, имя пользователя и ключи API.',
			description_markdown: 'Позволяет пользователям управлять настройками своей учетной записи, включая смену паролей, переименование своей учетной записи и управление ключами API для интеграций.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['пользователь', 'настройки', 'учетная запись', 'профиль']
		},
		'uk-UA': {
			name: 'Настройки користувача',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: 'Керування налаштуваннями облікового запису користувача, такими як пароль, ім\'я користувача та ключі API.',
			description_markdown: 'Дозволяє користувачам керувати налаштуваннями свого облікового запису, включаючи зміну паролів, перейменування свого облікового запису та керування ключами API для інтеграцій.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['користувач', 'налаштування', 'обліковий запис', 'профіль']
		},
		'vi-VN': {
			name: 'Cài đặt người dùng',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: 'Quản lý cài đặt tài khoản người dùng, chẳng hạn như mật khẩu, tên người dùng và khóa API.',
			description_markdown: 'Cho phép người dùng quản lý cài đặt tài khoản của họ, bao gồm thay đổi mật khẩu, đổi tên tài khoản và quản lý khóa API để tích hợp.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['người dùng', 'cài đặt', 'tài khoản', 'hồ sơ']
		},
		'zh-TW': {
			name: '用戶設置',
			avatar: 'https://api.iconify.design/line-md/account.svg',
			description: '管理用戶帳戶設置，例如密碼、用戶名和 API 密鑰。',
			description_markdown: '允許用戶管理其帳戶設置，包括更改密碼、重命名帳戶以及管理用於集成的 API 密鑰。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['用戶', '設置', '帳戶', '個人資料']
		}
	},
	/**
			 * 加载 shell。
	 * @param {object} options - 选项。
	 * @param {object} options.router - 路由。
	 */
	Load: async ({ router }) => {
		setEndpoints(router)
	},
	/**
			 * 卸载 shell。
	 */
	Unload: async () => { },
	/**
			 * Shell 的接口。
	 */
	interfaces: {
		/**
						 * 调用接口。
		 */
		invokes: {
			/**
									 * 处理命令行参数。
			 * @param {string} user - 用户。
			 * @param {Array<string>} args - 参数。
			 */
			ArgumentsHandler: async (user, args) => {
				const action = args[0]
				const params = {}
				switch (action) {
					case 'change-password':
						params.currentPassword = args[1]
						params.newPassword = args[2]
						break
					case 'revoke-device':
						params.tokenJti = args[1]
						params.password = args[2]
						break
					case 'rename-user':
						params.newUsername = args[1]
						params.password = args[2]
						break
					case 'delete-account':
						params.password = args[1]
						break
					case 'create-apikey':
						params.description = args[1]
						break
					case 'revoke-apikey':
						params.jti = args[1]
						break
				}
				const result = await handleAction(user, action, params)
				if (result !== undefined)
					console.log(result)

			},
			/**
									 * 处理 IPC 调用。
			 * @param {string} user - 用户。
			 * @param {object} data - 数据。
			 * @returns {Promise<any>} - 调用结果。
			 */
			IPCInvokeHandler: async (user, data) => {
				const { action, ...params } = data
				return handleAction(user, action, params)
			}
		}
	}
}
