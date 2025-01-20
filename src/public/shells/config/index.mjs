import { createJSONEditor } from 'https://cdn.jsdelivr.net/npm/vanilla-jsoneditor@2/standalone.js'
import { applyTheme } from '../../scripts/theme.mjs'
import { getPartTypes, getParts, getPartDetails, saveConfigData, getConfigData } from './src/public/endpoints.mjs' // 导入 API 模块
import { showErrorMessage } from './src/public/error.mjs'

const jsonEditorContainer = document.getElementById('jsonEditor')
if (applyTheme()) jsonEditorContainer.classList.add('jse-theme-dark')

const partTypeSelect = document.getElementById('partTypeSelect')
const partSelect = document.getElementById('partSelect')
const saveButton = document.getElementById('saveButton')
const disabledIndicator = document.getElementById('disabledIndicator')

let jsonEditor = null
let partTypes = []
let parts = []
let activePartType = null
let activePart = null
let isDirty = false

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
	} catch (err) {
		console.error('Failed to fetch part types:', err)
		showErrorMessage(err.message)
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
	defaultOption.textContent = '请选择'
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
	} catch (err) {
		console.error('Failed to fetch parts:', err)
		showErrorMessage(err.message)
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
	defaultOption.textContent = '请选择'
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
 * 加载编辑器
 * @param {string} partType 部分类型
 * @param {string} partName 部分名称
 */
async function loadEditor(partType, partName) {
	if (isDirty)
		if (!confirm('You have unsaved changes. Do you want to discard them?'))
			return

	try {
		const partDetailsData = await getPartDetails(partType, partName)

		if (!jsonEditor)
			jsonEditor = createJSONEditor({
				target: jsonEditorContainer,
				props: {
					mode: 'code',
					indentation: '\t',
					readOnly: true,
					onChange: (updatedContent, previousContent, { error, patchResult }) => {
						isDirty = true
					},
				}
			})

		if (!partDetailsData || !partDetailsData.supportedInterfaces.includes('config')) {
			disableEditorAndSaveButton()
			isDirty = false
			return
		} else {
			disabledIndicator.classList.add('hidden')
			saveButton.disabled = false
			jsonEditor.updateProps({ readOnly: false })
		}

		activePart = partName
		const data = await getConfigData(partType, partName)
		jsonEditor.updateProps({ content: { json: data } })
		isDirty = false
	} catch (err) {
		showErrorMessage(err.message)
		console.error('Failed to load editor:', err)
		disableEditorAndSaveButton()
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
	try {
		await saveConfigData(activePartType, activePart, data)
		isDirty = false
	} catch (err) {
		showErrorMessage(err.message)
		console.error('Failed to save part config:', err)
	}
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
		} else
			disableEditorAndSaveButton()

	} else {
		await fetchPartTypes()
		disableEditorAndSaveButton()
	}
}

// 初始化
initializeFromURLParams()

// 事件监听
partTypeSelect.addEventListener('change', async () => {
	if (isDirty)
		if (!confirm('You have unsaved changes. Do you want to discard them?')) {
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
		if (!confirm('You have unsaved changes. Do you want to discard them?')) {
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

window.addEventListener('beforeunload', (event) => {
	if (isDirty) {
		event.preventDefault()
		event.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
	}
})

window.addEventListener('popstate', () => {
	initializeFromURLParams()
})
