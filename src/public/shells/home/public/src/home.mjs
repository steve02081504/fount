/**
 * 主页 shell 的客户端逻辑。
 */

import { getUserSetting, unlockAchievement } from '../../../scripts/endpoints.mjs'
import { initTranslations, console } from '../../../scripts/i18n.mjs'
import { getDefaultParts } from '../../../scripts/parts.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
import { showToast } from '../../../scripts/toast.mjs'

import { getpartDetails } from './data.mjs'
import { getHomeRegistry } from './endpoints.mjs'
import { setupDOMEventListeners, setupServerEventListeners } from './events.mjs'
import { setHomeRegistry, setDefaultParts, setIsSfw, setCurrentPartType, homeRegistry, preloadDragGenerators, currentPartType } from './state.mjs'
import { showItemModal } from './ui/itemModal.mjs'
import {
	setupPartTypeUI,
	displayFunctionButtons,
	updateTabContent
} from './ui.mjs'


/**
 * 加载数据并渲染UI。
 * @returns {Promise<void>}
 */
export async function loadDataAndRender() {
	try {
		setHomeRegistry(await getHomeRegistry())
		await preloadDragGenerators(homeRegistry)
		setDefaultParts(await getDefaultParts())
		setupPartTypeUI(homeRegistry.part_types)
		displayFunctionButtons()
		setIsSfw(await getUserSetting('sfw').catch(() => false))
	}
	catch (error) {
		console.error('Failed to fetch initial data:', error)
		showToast('error', 'Failed to load page data. Please try refreshing.')
		throw error
	}
}

/**
 * 初始化应用程序。
 * @returns {Promise<void>}
 */
export async function initializeApp() {
	applyTheme()
	await initTranslations('home')

	// 获取数据并设置UI
	try { await loadDataAndRender() }
	catch (error) {
		return // Stop execution if essential data fails to load
	}

	const urlParams = new URLSearchParams(window.location.search)
	const query = urlParams.get('search')
	const paramPartType = urlParams.get('parttype') || sessionStorage.getItem('fount.home.lastTab')
	const paramPartName = urlParams.get('partname')

	const initialPartType = homeRegistry.part_types.find(pt => pt.name === paramPartType) || homeRegistry.part_types[0]
	setCurrentPartType(initialPartType)
	if (paramPartName) {
		const partdetails = await getpartDetails(paramPartType, paramPartName, true)
		if (partdetails) {
			const part = { parttype: paramPartType, partname: paramPartName, partdetails, partTypeConfig: initialPartType }
			showItemModal(part)
		}
	}

	if (query) {
		document.getElementById('filter-input').value = query
		document.getElementById('filter-input').dispatchEvent(new Event('input'))
	}

	setupDOMEventListeners()
	setupServerEventListeners()

	unlockAchievement('shells', 'home', 'first_login')
}

/**
 * 重新加载应用程序数据并刷新UI。
 * 用于从冷启动模式恢复。
 * @returns {Promise<void>}
 */
export async function refreshApp() {
	await loadDataAndRender()
	updateTabContent(currentPartType)
}
