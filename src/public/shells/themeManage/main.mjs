import { loadData, saveData } from '../../../../server/setting_loader.mjs'
import { builtin_themes } from '../../../../pages/scripts/theme.mjs'

const THEME_CONFIG_KEY = 'theme'

export default {
	info: {
		'': {
			name: 'theme Manage',
			avatar: '',
			description: 'default description',
			description_markdown: 'default description',
			version: '1.0.0',
			author: 'steve02081504',
			home_page: '',
			tags: []
		}
	},
	Load: async ({ router }) => { },
	Unload: async () => { },
	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const action = args[0]
				const themeName = args[1]

				const settings = loadData(user, 'settings')

				switch (action) {
					case 'list':
						console.log('Available themes:\nauto\n' + builtin_themes.join('\n'))
						break
					case 'get':
						console.log(`Current theme: ${settings[THEME_CONFIG_KEY] || 'auto'}`)
						break
					case 'set':
						if (!themeName) throw new Error('Theme name is required for set action.')
						if (themeName !== 'auto' && !builtin_themes.includes(themeName)) throw new Error(`Theme '${themeName}' not found.`) 
						settings[THEME_CONFIG_KEY] = themeName
						saveData(user, 'settings')
						console.log(`Theme set to '${themeName}'.`)
						break
					default:
						throw new Error(`Unknown action: ${action}. Available actions: list, get, set`)
				}
			},
			IPCInvokeHandler: async (user, { action, themeName }) => {
				const settings = loadData(user, 'settings')
				switch (action) {
					case 'list':
						return ['auto', ...builtin_themes]
					case 'get':
						return settings[THEME_CONFIG_KEY] || 'auto'
					case 'set':
						if (!themeName) throw new Error('Theme name is required for set action.')
						if (themeName !== 'auto' && !builtin_themes.includes(themeName)) throw new Error(`Theme '${themeName}' not found.`) 
						settings[THEME_CONFIG_KEY] = themeName
						saveData(user, 'settings')
						return `Theme set to '${themeName}'.`
					default:
						throw new Error(`Unknown action: ${action}. Available actions: list, get, set`)
				}
			}
		}
	}
}
