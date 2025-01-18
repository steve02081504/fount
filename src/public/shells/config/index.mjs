import { createJSONEditor } from 'https://cdn.jsdelivr.net/npm/vanilla-jsoneditor@2/standalone.js'
import { applyTheme } from '../../scripts/theme.mjs'

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
let isDirty = false // 标记是否有未保存的更改

/**
 * 抽象的API请求函数
 * @param {string} url API路径
 * @param {object} options 请求选项
 * @returns {Promise<any>} 响应数据
 */
async function fetchData(url, options = {}) {
	const response = await fetch(url, options)
	if (!response.ok)
		throw new Error(`HTTP error! status: ${response.status}`)

	return await response.json()
}

/**
 * 获取部分类型列表
 */
async function partTypesList() {
	try {
		partTypes = await fetchData('/api/getparttypelist')
		renderPartTypeSelect()
	} catch (error) {
		console.error('Failed to fetch part types:', error)
	}
}

/**
 * 渲染部分类型选择器
 */
function renderPartTypeSelect() {
	partTypeSelect.innerHTML = '<option disabled selected>请选择</option>'
	partTypes.forEach(partType => {
		const option = document.createElement('option')
		option.value = partType
		option.textContent = partType
		partTypeSelect.appendChild(option)
	})
}

/**
 * 根据部分类型获取部分列表
 * @param {string} partType 部分类型
 */
async function partsList(partType) {
	try {
		parts = await fetchData(`/api/getlist/${partType}`)
		renderPartSelect()
	} catch (error) {
		console.error('Failed to fetch parts:', error)
	}
}

/**
 * 根据部分类型和名称获取部分详情
 * @param {string} partType 部分类型
 * @param {string} partName 部分名称
 * @returns {Promise<any>} 部分详情
 */
async function partDetails(partType, partName) {
	try {
		return await fetchData(`/api/getdetails/${partType}?name=${partName}`)
	} catch (error) {
		console.error('Failed to fetch part details:', error)
		return null
	}
}

/**
 * 渲染部分选择器
 */
function renderPartSelect() {
	partSelect.innerHTML = '<option disabled selected>请选择</option>'
	partSelect.disabled = false
	parts.forEach(partName => {
		const option = document.createElement('option')
		option.value = partName
		option.textContent = partName
		partSelect.appendChild(option)
	})
}

/**
 * 加载编辑器
 * @param {string} partType 部分类型
 * @param {string} partName 部分名称
 */
async function loadEditor(partType, partName) {
	// 如果有未保存的更改，提示用户
	if (isDirty)
		if (!confirm('You have unsaved changes. Do you want to discard them?'))
			return

	const partDetailsData = await partDetails(partType, partName)

	// Create jsonEditor instance if it doesn't exist
	if (!jsonEditor)
		jsonEditor = createJSONEditor({
			target: jsonEditorContainer,
			props: {
				mode: 'code',
				indentation: '\t',
				readOnly: true, // 初始状态应为只读
				onChange: (updatedContent, previousContent, { error, patchResult }) => {
					isDirty = true // 标记为有未保存的更改
				},
			}
		})

	if (!partDetailsData || !partDetailsData.supportedInterfaces.includes('config')) {
		disabledIndicator.classList.remove('hidden')
		saveButton.disabled = true
		jsonEditor.updateProps({ readOnly: true, content: { json: {} } })
		isDirty = false // 重置未保存标记
		return
	} else {
		disabledIndicator.classList.add('hidden')
		saveButton.disabled = false
		jsonEditor.updateProps({ readOnly: false })
	}

	activePart = partName
	try {
		const data = await fetchData('/api/shells/config/getdata', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ parttype: partType, partname: partName }),
		})
		jsonEditor.updateProps({ content: { json: data } })
		isDirty = false // 重置未保存标记
	} catch (error) {
		console.error('Failed to fetch part data:', error)
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
		await fetchData('/api/shells/config/setdata', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				parttype: activePartType,
				partname: activePart,
				data
			}),
		})
		console.log('Part config saved successfully.')
		isDirty = false // 重置未保存标记
	} catch (error) {
		console.error('Failed to save part config:', error)
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
 * 根据 URL 参数预设选择器和加载编辑器
 */
async function initializeFromURLParams() {
	const urlParams = getURLParams()
	const partType = urlParams.get('type')
	const partName = urlParams.get('name')

	if (partType) {
		await partTypesList() // 确保部分类型已加载
		partTypeSelect.value = partType
		activePartType = partType
		await partsList(partType)

		if (partName) {
			partSelect.value = partName
			activePart = partName
			await loadEditor(partType, partName)
		} else {
			// 如果提供了 partType 但没有 partName，禁用编辑器
			if (jsonEditor)
				jsonEditor.updateProps({ readOnly: true, content: { json: {} } })

			disabledIndicator.classList.remove('hidden')
			saveButton.disabled = true
		}
	} else {
		await partTypesList()
		// 初始状态下禁用编辑器
		if (jsonEditor)
			jsonEditor.updateProps({ readOnly: true, content: { json: {} } })

		disabledIndicator.classList.remove('hidden')
		saveButton.disabled = true
	}
}

// 初始化
initializeFromURLParams()

// 事件监听
partTypeSelect.addEventListener('change', async () => {
	// 如果有未保存的更改，提示用户
	if (isDirty)
		if (!confirm('You have unsaved changes. Do you want to discard them?')) {
			partTypeSelect.value = activePartType
			return
		}

	activePartType = partTypeSelect.value
	await partsList(activePartType)
	partSelect.selectedIndex = 0 // 重置部分选择器
	activePart = null // 关键：重置 activePart

	// 禁用编辑器和保存按钮，直到选择了部件
	if (jsonEditor)
		jsonEditor.updateProps({ readOnly: true, content: { json: {} } })

	disabledIndicator.classList.remove('hidden')
	saveButton.disabled = true

	// 检查新的 PartType 是否有 Parts
	if (parts.length > 0) {
		// 检查第一个 Part 是否支持配置（可选，根据你的需求）
		const firstPartName = parts[0]
		const firstPartDetails = await partDetails(activePartType, firstPartName)

		if (!jsonEditor)
			jsonEditor = createJSONEditor({
				target: jsonEditorContainer,
				props: {
					mode: 'code',
					indentation: '\t',
					readOnly: true,
					onChange: (updatedContent, previousContent, { error, patchResult }) => {
						isDirty = true // 标记为有未保存的更改
					},
				}
			})

		if (!firstPartDetails || !firstPartDetails.supportedInterfaces.includes('config')) {
			// 第一个 Part 不支持配置，保持禁用状态
		} else {
			// 第一个 Part 支持配置，但由于 activePart 仍然是 null，编辑器保持禁用
		}
	} else {
		// 新的 PartType 没有 Parts，保持禁用状态
	}
	isDirty = false // 重置未保存标记
})

partSelect.addEventListener('change', async () => {
	// 如果有未保存的更改，提示用户
	if (isDirty)
		if (!confirm('You have unsaved changes. Do you want to discard them?')) {
			partSelect.value = activePart
			return
		}
	activePart = partSelect.value
	if (activePart)
		await loadEditor(activePartType, activePart)
	else {
		// 如果取消选择部件，禁用编辑器
		if (jsonEditor)
			jsonEditor.updateProps({ readOnly: true, content: { json: {} } })

		disabledIndicator.classList.remove('hidden')
		saveButton.disabled = true
	}
})

saveButton.addEventListener('click', saveConfig)

// 离开页面时提醒
window.addEventListener('beforeunload', (event) => {
	if (isDirty) {
		event.preventDefault()
		event.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
	}
})
