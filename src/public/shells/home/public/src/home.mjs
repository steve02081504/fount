/**
 * 主页 shell 的客户端逻辑。
 */

import { getUserSetting, unlockAchievement } from '../../../scripts/endpoints.mjs'
import { initTranslations, console } from '../../../scripts/i18n.mjs'
import { getDefaultParts } from '../../../scripts/parts.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
import { showToast } from '../../../scripts/toast.mjs'

import { getHomeRegistry } from './endpoints.mjs'
import { setupDOMEventListeners, setupServerEventListeners } from './events.mjs'
import { setHomeRegistry, setDefaultParts, setIsSfw, setCurrentPartType, homeRegistry, preloadDragGenerators } from './state.mjs'
import {
	setupPartTypeUI,
	displayFunctionButtons
} from './ui.mjs'


/**
 * 初始化应用程序。
 * @returns {Promise<void>}
 */
export async function initializeApp() {
	applyTheme()
	await initTranslations('home')

	unlockAchievement('shells', 'home', 'first_login')

	// 获取数据并设置UI
	try {
		setHomeRegistry(await getHomeRegistry())
		await preloadDragGenerators(homeRegistry)
		setDefaultParts(await getDefaultParts())
	}
	catch (error) {
		console.error('Failed to fetch initial data:', error)
		showToast('error', 'Failed to load page data. Please try refreshing.')
		return // Stop execution if essential data fails to load
	}

	setupPartTypeUI(homeRegistry.part_types)
	displayFunctionButtons()

	setIsSfw(await getUserSetting('sfw').catch(() => false))
	const lastTab = sessionStorage.getItem('fount.home.lastTab')
	setCurrentPartType(homeRegistry.part_types.find(pt => pt.name === lastTab) || homeRegistry.part_types[0])

	setupDOMEventListeners()
	setupServerEventListeners()
}
