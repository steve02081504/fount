import { setUserSetting } from '../../../scripts/endpoints.mjs'
import { confirmI18n, geti18n, onLanguageChange } from '../../../scripts/i18n.mjs'
import { unlockAchievement } from '../../../scripts/parts.mjs'
import { onServerEvent } from '../../../scripts/server_events.mjs'
import { showToastI18n } from '../../../scripts/toast.mjs'

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
		await setupPartTypeUI(homeRegistry.part_types)
		await displayFunctionButtons()
		await refreshCurrentTab()
	}).catch(error => console.error('获取主页注册表失败:', error))
}

/**
 * 解析部件路径为类型和名称。
 * @param {string} partpath - 部件路径。
 * @returns {{ type: string, name: string } | null} 解析后的部件信息，如果路径无效则返回 null。
 */
function parsePartPath(partpath) {
	if (!partpath) return null
	const normalizedPartpath = partpath.replace(/^\/+|\/+$/g, '')
	const [resolvedType, ...rest] = normalizedPartpath.split('/')
	const resolvedName = rest.join('/')
	return { type: resolvedType, name: resolvedName }
}

/**
 * 处理 'part-installed' 服务端事件。
 * @param {object} payload - 事件负载。
 * @param {string} payload.partpath - 已安装部件的完整路径。
 * @returns {Promise<void>}
 */
export const handlePartInstalled = async ({ partpath }) => {
	const parsed = parsePartPath(partpath)
	if (!parsed) return
	partListsCache[parsed.type] ??= []
	partListsCache[parsed.type].push(parsed.name)
	if (currentPartType?.name === parsed.type)
		await updateTabContent(currentPartType)
}

/**
 * 处理 'part-uninstalled' 服务端事件。
 * @param {object} payload - 事件负载。
 * @param {string} payload.partpath - 已卸载部件的完整路径。
 * @returns {Promise<void>}
 */
export const handlePartUninstalled = async ({ partpath }) => {
	const parsed = parsePartPath(partpath)
	if (!parsed) return
	const index = partListsCache[parsed.type]?.indexOf(parsed.name)
	if (index > -1) partListsCache[parsed.type].splice(index, 1)
	delete partDetailsCache[partpath.replace(/^\/+|\/+$/g, '')]
	if (currentPartType?.name === parsed.type)
		await updateTabContent(currentPartType)
}
/**
 * 更新默认部件状态。
 * @param {boolean} isSet - 是否设置为默认。
 * @param {object} payload - 事件负载。
 * @param {string} [payload.parent] - 父部件类型。
 * @param {string} [payload.child] - 子部件名称。
 */
export function handleDefaultPartUpdate(isSet, { parent, child }) {
	if (!parent || !child) return
	const updatedDefaultParts = { ...defaultParts }

	if (isSet) {
		updatedDefaultParts[parent] ??= []
		if (!updatedDefaultParts[parent].includes(child))
			updatedDefaultParts[parent].push(child)
	} else {
		const parts = updatedDefaultParts[parent] ?? []
		const index = parts.indexOf(child)
		if (index > -1) parts.splice(index, 1)
		if (!parts.length) delete updatedDefaultParts[parent]
	}

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
			unlockAchievement('shells/home', isSfw ? 'sfw_mode_on' : 'sfw_mode_off')
			refreshCurrentTab()
		}
		catch (e) {
			console.error('Failed to set SFW state', e)
			setIsSfw(sfwToggle.checked = !isSfw)
		}
	})

	onLanguageChange(() => refreshCurrentTab())

	functionMenuButton.addEventListener('focus', () => {
		unlockAchievement('shells/home', 'open_function_list')
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
		const { dataTransfer } = event
		if (!dataTransfer) return

		const handlers = homeRegistry.home_drag_in_handlers || []
		for (const handlerConfig of handlers) try {
			const handlerModule = await import(handlerConfig.path)
			const handled = await handlerModule.default?.(dataTransfer, handlerConfig)
			if (handled) return showToastI18n('success', 'home.dragAndDrop.dropSuccess')
		} catch (error) {
			console.error(`Error importing or executing drag-in handler from ${handlerConfig.path}:`, error)
			showToastI18n('error', 'home.dragAndDrop.dropError', { error: error.message })
		}

		showToastI18n('warning', 'home.dragAndDrop.noHandler')
	})
}

/**
 * 设置所有服务端事件监听器。
 * @returns {void}
 */
export function setupServerEventListeners() {
	onServerEvent('default-part-setted', payload => handleDefaultPartUpdate(true, payload))
	onServerEvent('default-part-unsetted', payload => handleDefaultPartUpdate(false, payload))
	onServerEvent('home-registry-updated', handleHomeRegistryUpdate)
	onServerEvent('part-installed', handlePartInstalled)
	onServerEvent('part-uninstalled', handlePartUninstalled)
}
