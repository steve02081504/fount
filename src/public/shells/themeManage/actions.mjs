import { loadData, saveData } from '../../../../server/setting_loader.mjs'
import { builtin_themes } from '../../../../pages/scripts/theme.mjs'

const THEME_CONFIG_KEY = 'theme'

export const actions = {
	list: () => ['auto', ...builtin_themes],
	get: ({ user }) => {
		const settings = loadData(user, 'settings')
		return settings[THEME_CONFIG_KEY] || 'auto'
	},
	set: ({ user, themeName }) => {
		if (!themeName) throw new Error('Theme name is required for set action.')
		if (themeName !== 'auto' && !builtin_themes.includes(themeName)) throw new Error(`Theme '${themeName}' not found.`)
		const settings = loadData(user, 'settings')
		settings[THEME_CONFIG_KEY] = themeName
		saveData(user, 'settings')
		return `Theme set to '${themeName}'.`
	}
}
