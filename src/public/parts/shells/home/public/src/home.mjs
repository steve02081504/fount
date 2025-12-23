/**
 * 主页 shell 的客户端逻辑。
 */

import { getUserSetting } from '../../../scripts/endpoints.mjs'
import { initTranslations, console } from '../../../scripts/i18n.mjs'
import { unlockAchievement, getAllDefaultParts, getPartBranches } from '../../../scripts/parts.mjs'
import { applyTheme, serializeCurrentTheme } from '../../../scripts/theme.mjs'
import { showToast } from '../../../scripts/toast.mjs'
import { applyUrlParamsTransferStrategy } from '../../../scripts/urlDataTransfer.mjs'

import { getHomeRegistry } from './endpoints.mjs'
import { setupDOMEventListeners, setupServerEventListeners } from './events.mjs'
import { setHomeRegistry, setDefaultParts, setIsSfw, setPartBranches, homeRegistry, preloadDragGenerators, currentPartType } from './state.mjs'
import {
	setupPartTypeUI,
	displayFunctionButtons,
	updateTabContent
} from './ui.mjs'


/**
 * 加载数据并渲染UI。
 * @param {string} [initialPath] - 可选的初始路径。
 * @returns {Promise<void>}
 */
export async function loadDataAndRender(initialPath) {
	try {
		setHomeRegistry(await getHomeRegistry())
		setPartBranches(await getPartBranches(true))
		await preloadDragGenerators(homeRegistry)
		setDefaultParts(await getAllDefaultParts())
		await setupPartTypeUI(homeRegistry.part_types, initialPath)
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
 * 获取要传递给 GitHub 页面的通用 URL 参数。
 * @returns {Promise<object>} - 参数对象。
 */
async function getCommonUrlParamsForGitHub() {
	const themeData = serializeCurrentTheme()
	const params = {
		themeData: JSON.stringify(themeData),
		hostUrl: window.location.origin,
		userPreferredLanguages: localStorage.getItem('userPreferredLanguages') || undefined,
	}
	for (const key in params) if (params[key] === undefined) delete params[key]
	return params
}

/**
 * 通过 iframe 将设置同步到 GitHub Pages。
 * @returns {Promise<HTMLIFrameElement>} - 创建的 iframe 元素。
 */
async function syncSettingsToGitHubPages() {
	const iframe = document.createElement('iframe')
	iframe.ariaHidden = true
	iframe.style.display = 'none'

	const params = await getCommonUrlParamsForGitHub()
	const targetUrl = new URL('https://steve02081504.github.io/fount/values_update')

	await applyUrlParamsTransferStrategy(targetUrl, new URLSearchParams(params))

	iframe.src = targetUrl.toString()
	return document.body.appendChild(iframe)
}

/**
 * 初始化应用程序。
 * @returns {Promise<void>}
 */
export async function initializeApp() {
	applyTheme()
	await initTranslations('home')

	const urlParams = new URLSearchParams(window.location.search)
	const query = urlParams.get('search')
	const paramPath = urlParams.get('partpath') || 'chars'

	// 获取数据并设置UI
	try { await loadDataAndRender(paramPath) }
	catch (error) {
		return // Stop execution if essential data fails to load
	}

	if (query) {
		document.getElementById('filter-input').value = query
		document.getElementById('filter-input').dispatchEvent(new Event('input'))
	}

	setupDOMEventListeners()
	setupServerEventListeners()

	unlockAchievement('shells', 'home', 'first_login')

	syncSettingsToGitHubPages().then(iframe => {
		iframe.addEventListener('load', () => {
			iframe.remove()
		}, { once: true })
	})
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
