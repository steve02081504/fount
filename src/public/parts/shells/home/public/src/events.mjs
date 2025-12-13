import { setUserSetting, unlockAchievement } from '../../../scripts/endpoints.mjs'
import { confirmI18n, geti18n, onLanguageChange } from '../../../scripts/i18n.mjs'
import { onServerEvent } from '../../../scripts/server_events.mjs'
import { showToast } from '../../../scripts/toast.mjs'

import { partDetailsCache, partListsCache } from './data.mjs'
import { getHomeRegistry } from './endpoints.mjs'
import { setHomeRegistry, setDefaultParts, setIsSfw, homeRegistry, defaultParts, isSfw, currentPartType, preloadDragGenerators } from './state.mjs'
import {
	functionMenuButton, sfwToggle,
	setupPartTypeUI, displayFunctionButtons, updateTabContent, refreshCurrentTab, updateDefaultPartDisplay
} from './ui.mjs'

/**
 * 处理 'home-registry-updated' 服务端事件。
 * 刷新主页注册表，更新UI，并重新渲染当前选项卡。
 * @returns {Promise<void>}
 */
export const handleHomeRegistryUpdate = async () => {
	await getHomeRegistry().then(async data => {
		setHomeRegistry(data)
		await preloadDragGenerators(data)
		setupPartTypeUI(homeRegistry.part_types)
		await displayFunctionButtons()
		await refreshCurrentTab()
	}).catch(error => console.error('获取主页注册表失败:', error))
}

/**
 * 处理 'part-installed' 服务端事件。
 * 如果部件类型匹配，则将新安装的部件添加到缓存并更新当前选项卡。
 * @param {object} payload - 事件负载。
 * @param {string} payload.parttype - 已安装部件的类型。
 * @param {string} payload.partname - 已安装部件的名称。
 * @returns {Promise<void>}
 */
export const handlePartInstalled = async ({ parttype, partname }) => {
	partListsCache[parttype] ??= []
	partListsCache[parttype].push(partname)
	if (currentPartType && parttype === currentPartType.name)
		await updateTabContent(currentPartType)
}

/**
 * 处理 'part-uninstalled' 服务端事件。
 * 如果部件类型匹配，则从缓存中删除已卸载的部件并更新当前选项卡。
 * @param {object} payload - 事件负载。
 * @param {string} payload.parttype - 已卸载部件的类型。
 * @param {string} payload.partname - 已卸载部件的名称。
 * @returns {Promise<void>}
 */
export const handlePartUninstalled = async ({ parttype, partname }) => {
	if (partListsCache[parttype]) {
		const index = partListsCache[parttype].indexOf(partname)
		if (index > -1) partListsCache[parttype].splice(index, 1)
	}
	if (partDetailsCache[parttype]) {
		delete partDetailsCache[parttype][partname]
		if (!Object.keys(partDetailsCache[parttype]).length)
			delete partDetailsCache[parttype]
	}

	if (currentPartType && parttype === currentPartType.name)
		await updateTabContent(currentPartType)
}
/**
 * 处理 'default-part-setted' 服务端事件。
 * @param {object} payload - 事件负载。
 * @param {string} payload.parttype - 已设置默认部件的类型。
 * @param {string} payload.partname - 新的默认部件的名称。
 */
export const handleDefaultPartSetted = ({ parttype, partname }) => {
	const updatedDefaultParts = { ...defaultParts }
	updatedDefaultParts[parttype] ??= []
	updatedDefaultParts[parttype].push(partname)
	setDefaultParts(updatedDefaultParts)

	updateDefaultPartDisplay()
}

/**
 * 处理 'default-part-unsetted' 服务端事件。
 * @param {object} payload - 事件负载。
 * @param {string} payload.parttype - 已取消设置默认部件的类型。
 * @param {string} payload.partname - 已取消设置的默认部件的名称。
 */
export const handleDefaultPartUnsetted = ({ parttype, partname }) => {
	const updatedDefaultParts = { ...defaultParts }
	const parts = updatedDefaultParts[parttype] ?? []
	const index = parts.indexOf(partname)
	if (index > -1) parts.splice(index, 1)
	if (!parts.length) delete updatedDefaultParts[parttype]
	setDefaultParts(updatedDefaultParts)

	updateDefaultPartDisplay()
}

/**
 * 设置所有DOM事件监听器。
 * @returns {void}
 */
export function setupDOMEventListeners() {
	// SFW 切换
	sfwToggle.checked = isSfw
	sfwToggle.addEventListener('change', async () => {
		if (sfwToggle.checked === isSfw) return
		try {
			await setUserSetting('sfw', sfwToggle.checked)
			setIsSfw(sfwToggle.checked)
			unlockAchievement('shells', 'home', isSfw ? 'sfw_mode_on' : 'sfw_mode_off')
			refreshCurrentTab()
		}
		catch (e) {
			console.error('Failed to set SFW state', e)
			setIsSfw(sfwToggle.checked = !isSfw)
		}
	})

	onLanguageChange(() => refreshCurrentTab())

	functionMenuButton.addEventListener('focus', () => {
		unlockAchievement('shells', 'home', 'open_function_list')
	}, { once: true })

	// Esc键确认
	document.addEventListener('keydown', event => {
		if (event.key === 'Escape')
			if (!confirmI18n('home.escapeConfirm'))
				event.stopImmediatePropagation()
	}, true)

	// 拖放处理
	document.body.addEventListener('dragover', event => {
		event.preventDefault() // 允许放置
	})

	document.body.addEventListener('drop', async event => {
		event.preventDefault()
		const dataTransfer = event.dataTransfer
		if (!dataTransfer) return

		const handlers = homeRegistry.home_drag_in_handlers || []
		for (const handlerConfig of handlers) try {
			const handlerModule = await import(handlerConfig.path)
			const handled = await handlerModule.default?.(dataTransfer, handlerConfig)
			if (handled) return showToast('success', geti18n('home.dragAndDrop.dropSuccess'))
		} catch (error) {
			console.error(`Error importing or executing drag-in handler from ${handlerConfig.path}:`, error)
			showToast('error', geti18n('home.dragAndDrop.dropError', { error: error.message }))
		}

		showToast('warning', geti18n('home.dragAndDrop.noHandler'))
	})
}

/**
 * 设置所有服务端事件监听器。
 * @returns {void}
 */
export function setupServerEventListeners() {
	onServerEvent('default-part-setted', handleDefaultPartSetted)
	onServerEvent('default-part-unsetted', handleDefaultPartUnsetted)
	onServerEvent('home-registry-updated', handleHomeRegistryUpdate)
	onServerEvent('part-installed', handlePartInstalled)
	onServerEvent('part-uninstalled', handlePartUninstalled)
}
