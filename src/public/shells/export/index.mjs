
import { applyTheme } from '../../scripts/theme.mjs'
import { getPartTypes, getPartList, getFountJson, exportPart } from './src/public/endpoints.mjs'
import { showErrorMessage } from './src/public/error.mjs'
import { initTranslations, geti18n, console } from '../../scripts/i18n.mjs'

const partTypeSelect = document.getElementById('partTypeSelect')
const partSelect = document.getElementById('partSelect')
const exportButton = document.getElementById('exportButton')
const exportWithDataButton = document.getElementById('exportWithDataButton')
const exportStatusIcon = document.getElementById('exportStatusIcon')
const exportWithDataStatusIcon = document.getElementById('exportWithDataStatusIcon')
const disabledIndicator = document.getElementById('disabledIndicator')

let partTypes = []
let parts = []
let activePartType = null
let activePart = null
let fountJson = null

/**
 * 禁用导出按钮
 */
function disableExportButtons() {
	disabledIndicator.classList.remove('hidden')
	exportButton.disabled = true
	exportWithDataButton.disabled = true
	exportWithDataButton.classList.add('hidden')
}

/**
 * 启用导出按钮
 */
function enableExportButtons() {
	disabledIndicator.classList.add('hidden')
	exportButton.disabled = false
	if (fountJson && fountJson.data_files && fountJson.data_files?.length > 0) {
		exportWithDataButton.disabled = false
		exportWithDataButton.classList.remove('hidden')
	} else {
		exportWithDataButton.disabled = true
		exportWithDataButton.classList.add('hidden')
	}
}

/**
 * 获取部分类型列表
 */
async function fetchPartTypes() {
	try {
		partTypes = await getPartTypes()
		renderPartTypeSelect()
	} catch (err) {
		console.error('Failed to fetch part types:', err)
		showErrorMessage(geti18n('export.alerts.fetchPartTypesFailed') + ': ' + err.message)
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
	defaultOption.textContent = geti18n('export.placeholders.partTypeSelect')
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
		parts = await getPartList(partType)
		renderPartSelect()
	} catch (err) {
		console.error('Failed to fetch parts:', err)
		showErrorMessage(geti18n('export.alerts.fetchPartsFailed') + ': ' + err.message)
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
	defaultOption.textContent = geti18n('export.placeholders.partSelect')
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

/**
 * 加载部件详情
 * @param {string} partType 部分类型
 * @param {string} partName 部分名称
 */
async function loadPartDetails(partType, partName) {
	try {
		fountJson = await getFountJson(partType, partName)
		enableExportButtons()
	} catch (err) {
		showErrorMessage(geti18n('export.alerts.loadPartDetailsFailed') + ': ' + err.message)
		console.error('Failed to load part details:', err)
		disableExportButtons()
	}
}

/**
 * 处理导出
 * @param {boolean} withData
 */
async function handleExport(withData) {
	if (!activePartType || !activePart) {
		console.warn('No part selected to export.')
		return
	}

	const button = withData ? exportWithDataButton : exportButton
	const icon = withData ? exportWithDataStatusIcon : exportStatusIcon

	icon.src = 'https://api.iconify.design/line-md/loading-loop.svg'
	icon.classList.remove('hidden')
	button.disabled = true

	try {
		const blob = await exportPart(activePartType, activePart, withData)
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `${activePart}${withData ? '_with_data' : ''}.zip`
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(url)

		icon.src = 'https://api.iconify.design/line-md/confirm-circle.svg'
	} catch (err) {
		showErrorMessage(geti18n('export.alerts.exportFailed') + ': ' + err.message)
		console.error('Failed to export part:', err)
		icon.src = 'https://api.iconify.design/line-md/emoji-frown.svg'
	}

	setTimeout(() => {
		icon.classList.add('hidden')
		button.disabled = false
	}, 2000)
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
			await loadPartDetails(partType, partName)
		} else
			disableExportButtons()
	} else {
		await fetchPartTypes()
		disableExportButtons()
	}
}

// 初始化
applyTheme()
initTranslations('export')
initializeFromURLParams()

// 事件监听
partTypeSelect.addEventListener('change', async () => {
	activePartType = partTypeSelect.value
	await fetchParts(activePartType)
	partSelect.selectedIndex = 0
	activePart = null
	fountJson = null
	disableExportButtons()
	updateURLParams(activePartType, null)
})

partSelect.addEventListener('change', async () => {
	activePart = partSelect.value
	if (activePart) {
		await loadPartDetails(activePartType, activePart)
		updateURLParams(activePartType, activePart)
	}
	else {
		disableExportButtons()
		updateURLParams(activePartType, null)
	}
})

exportButton.addEventListener('click', () => handleExport(false))
exportWithDataButton.addEventListener('click', () => handleExport(true))

window.addEventListener('popstate', () => {
	initializeFromURLParams()
})
