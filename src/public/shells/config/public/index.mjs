import { async_eval } from 'https://esm.sh/@steve02081504/async-eval'

import { initTranslations, i18nElement, geti18n, confirmI18n, console } from '../../scripts/i18n.mjs'
import { createJsonEditor } from '../../scripts/jsonEditor.mjs'
import { svgInliner } from '../../scripts/svgInliner.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { showToast } from '../../scripts/toast.mjs'

import { getPartTypes, getParts, getPartDetails, saveConfigData, getConfigData, getPartDisplay } from './src/endpoints.mjs' // 导入 API 模块

const jsonEditorContainer = document.getElementById('jsonEditor')
const partDisplayContainer = document.getElementById('partDisplay')

const partTypeSelect = document.getElementById('partTypeSelect')
const partSelect = document.getElementById('partSelect')
const saveButton = document.getElementById('saveButton')
const saveStatusIcon = document.getElementById('saveStatusIcon')
const disabledIndicator = document.getElementById('disabledIndicator')

let jsonEditor = null
let partTypes = []
let parts = []
let activePartType = null
let activePart = null
let isDirty = false
let onJsonUpdate = () => 0

/**
 * 禁用编辑器和保存按钮
 */
function disableEditorAndSaveButton() {
	if (jsonEditor)
		jsonEditor.updateProps({ readOnly: true, content: { json: {} } })

	disabledIndicator.classList.remove('hidden')
	saveButton.disabled = true
}

/**
 * 获取部分类型列表
 */
async function fetchPartTypes() {
	try {
		partTypes = await getPartTypes()
		renderPartTypeSelect()
	}
	catch (err) {
		console.error('Failed to fetch part types:', err)
		showToast('error', geti18n('part_config.alerts.fetchPartTypesFailed') + ': ' + err.message)
	}
}

/**
 * 渲染部分类型选择器
 */
function renderPartTypeSelect() {
	const fragment = document.createDocumentFragment()
	const defaultOption = document.createElement('option')
	defaultOption.disabled = true
	defaultOption.selected = true
	defaultOption.dataset.i18n = 'part_config.placeholders.partTypeSelect'
	fragment.appendChild(defaultOption)

	partTypes.forEach(partType => {
		const option = document.createElement('option')
		option.value = partType
		option.textContent = partType
		fragment.appendChild(option)
	})

	partTypeSelect.innerHTML = ''
	partTypeSelect.appendChild(fragment)
}

/**
 * 根据部分类型获取部分列表
 * @param {string} partType 部分类型
 */
async function fetchParts(partType) {
	try {
		parts = await getParts(partType)
		renderPartSelect()
	}
	catch (err) {
		console.error('Failed to fetch parts:', err)
		showToast('error', geti18n('part_config.alerts.fetchPartsFailed') + ': ' + err.message)
	}
}

/**
 * 渲染部分选择器
 */
function renderPartSelect() {
	const fragment = document.createDocumentFragment()
	const defaultOption = document.createElement('option')
	defaultOption.disabled = true
	defaultOption.selected = true
	defaultOption.dataset.i18n = 'part_config.placeholders.partSelect'
	fragment.appendChild(defaultOption)

	parts.forEach(partName => {
		const option = document.createElement('option')
		option.value = partName
		option.textContent = partName
		fragment.appendChild(option)
	})

	partSelect.innerHTML = ''
	partSelect.disabled = false
	partSelect.appendChild(fragment)
}

async function loadPartAddons(partType, partName) {
	partDisplayContainer.innerHTML = ''
	onJsonUpdate = () => 0

	if (!partType || !partName) return

	try {
		const { html, js: displayScript } = await getPartDisplay(partType, partName)
		await initTranslations() // refresh translations for dynamic content maybe used in part i18n data
		partDisplayContainer.innerHTML = html
		await svgInliner(i18nElement(partDisplayContainer))
		if (displayScript) {
			const eval_result = await async_eval(displayScript, { geti18n, partType, partName, element: partDisplayContainer })
			if (eval_result.error) throw eval_result.error
			onJsonUpdate = eval_result.result || (() => 0)
		}
	}
	catch (e) {
		console.error('Error loading or evaluating part addons:', e)
		partDisplayContainer.innerHTML = `<div class="text-error">Error loading part display: ${e.message}</div>`
	}
}

/**
 * 加载编辑器
 * @param {string} partType 部分类型
 * @param {string} partName 部分名称
 */
async function loadEditor(partType, partName) {
	if (isDirty)
		if (!confirmI18n('part_config.alerts.unsavedChanges'))
			return

	try {
		await loadPartAddons(partType, partName)
		const partDetailsData = await getPartDetails(partType, partName)

		if (!jsonEditor)
			jsonEditor = createJsonEditor(jsonEditorContainer, {
				readOnly: true,
				onChange: () => {
					isDirty = true
					onJsonUpdate({
						info: {
							partType,
							partName
						},
						data: jsonEditor.get().json || JSON.parse(jsonEditor.get().text),
						containers: {
							partDisplay: partDisplayContainer,
							jsonEditor: jsonEditorContainer
						},
						editors: {
							json: jsonEditor
						}
					})
				},
				onSave: saveConfig
			})

		if (!partDetailsData || !partDetailsData.supportedInterfaces.includes('config')) {
			disableEditorAndSaveButton()
			isDirty = false
			return
		}
		else {
			disabledIndicator.classList.add('hidden')
			saveButton.disabled = false
			jsonEditor.updateProps({ readOnly: false })
		}

		activePart = partName
		const data = await getConfigData(partType, partName)
		jsonEditor.set({ json: data || {} })
		onJsonUpdate({
			info: {
				partType,
				partName
			},
			data: data || {},
			containers: {
				partDisplay: partDisplayContainer,
				jsonEditor: jsonEditorContainer
			},
			editors: {
				json: jsonEditor
			}
		})

		isDirty = false
	}
	catch (err) {
		console.error('Failed to load editor:', err)
		disableEditorAndSaveButton()
		showToast('error', geti18n('part_config.alerts.loadEditorFailed') + ': ' + err.message)
	}
}

/**
 * 保存配置
 */
async function saveConfig() {
	if (!activePartType || !activePart) {
		console.warn('No part selected to save.')
		return
	}
	const data = jsonEditor.get().json || JSON.parse(jsonEditor.get().text)

	// Show loading icon and disable button
	saveStatusIcon.src = 'https://api.iconify.design/line-md/loading-loop.svg'
	saveStatusIcon.classList.remove('hidden')
	saveButton.disabled = true

	try {
		await saveConfigData(activePartType, activePart, data)
		isDirty = false

		saveStatusIcon.src = 'https://api.iconify.design/line-md/confirm-circle.svg'
	}
	catch (err) {
		showToast('error', geti18n('part_config.alerts.saveConfigFailed') + ': ' + err.message)
		console.error('Failed to save part config:', err)

		saveStatusIcon.src = 'https://api.iconify.design/line-md/emoji-frown.svg'
	}
	// Hide icon and re-enable button after a delay
	setTimeout(() => {
		saveStatusIcon.classList.add('hidden')
		saveButton.disabled = false
	}, 2000) // 2 seconds delay
}

/**
 * 解析 URL 参数
 * @returns {URLSearchParams} URL 参数对象
 */
function getURLParams() {
	return new URLSearchParams(window.location.search)
}

/**
 * 更新 URL 参数
 * @param {string} partType 部分类型
 * @param {string} partName 部分名称
 */
function updateURLParams(partType, partName) {
	const urlParams = new URLSearchParams()
	if (partType)
		urlParams.set('type', partType)

	if (partName)
		urlParams.set('name', partName)

	const newURL = `${window.location.pathname}?${urlParams.toString()}`
	window.history.pushState({ path: newURL }, '', newURL)
}

/**
 * 根据 URL 参数预设选择器和加载编辑器
 */
async function initializeFromURLParams() {
	const urlParams = getURLParams()
	const partType = urlParams.get('type')
	const partName = urlParams.get('name')

	if (partType) {
		await fetchPartTypes()
		partTypeSelect.value = partType
		activePartType = partType
		await fetchParts(partType)

		if (partName) {
			partSelect.value = partName
			activePart = partName
			await loadEditor(partType, partName)
		}
		else disableEditorAndSaveButton()
	}
	else {
		await fetchPartTypes()
		disableEditorAndSaveButton()
	}
}

// 初始化
applyTheme()
await initTranslations('part_config')
initializeFromURLParams()

// 事件监听
partTypeSelect.addEventListener('change', async () => {
	if (isDirty)
		if (!confirmI18n('part_config.alerts.unsavedChanges')) {
			partTypeSelect.value = activePartType
			return
		}

	activePartType = partTypeSelect.value
	await fetchParts(activePartType)
	partSelect.selectedIndex = 0
	activePart = null
	disableEditorAndSaveButton()

	isDirty = false
	// 更新 URL 参数
	updateURLParams(activePartType, null)
})

partSelect.addEventListener('change', async () => {
	if (isDirty)
		if (!confirmI18n('part_config.alerts.unsavedChanges')) {
			partSelect.value = activePart
			return
		}

	activePart = partSelect.value
	if (activePart) {
		await loadEditor(activePartType, activePart)
		// 更新 URL 参数
		updateURLParams(activePartType, activePart)
	}
	else {
		disableEditorAndSaveButton()
		updateURLParams(activePartType, null)
	}
})

saveButton.addEventListener('click', saveConfig)

window.addEventListener('beforeunload', event => {
	if (isDirty) {
		event.preventDefault()
		event.returnValue = geti18n('part_config.alerts.beforeUnload')
	}
})

window.addEventListener('popstate', () => {
	initializeFromURLParams()
})
