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
	const partDetailsData = await partDetails(partType, partName)
	disabledIndicator.classList.add('hidden')
	saveButton.disabled = false
	jsonEditor?.enable()

	if (!partDetailsData || !partDetailsData.supportedInterfaces.includes('config')) {
		disabledIndicator.classList.remove('hidden')
		saveButton.disabled = true
		jsonEditor?.disable()
		return
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

		if (!jsonEditor)
			jsonEditor = createJSONEditor({
				target: jsonEditorContainer,
				props: {
					mode: 'code',
					indentation: '\t',
				}
			})

		jsonEditor.set({ json: data })
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
	const data = jsonEditor.get().json
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
		}
	} else
		await partTypesList()
}

// 初始化
initializeFromURLParams()

// 事件监听
partTypeSelect.addEventListener('change', async () => {
	activePartType = partTypeSelect.value
	await partsList(activePartType)
	partSelect.selectedIndex = 0 // 重置部分选择器
	activePart = null
	disabledIndicator.classList.add('hidden')
	saveButton.disabled = false
	jsonEditor?.enable()
})

partSelect.addEventListener('change', async () => {
	activePart = partSelect.value
	if (activePart)
		await loadEditor(activePartType, activePart)
})

saveButton.addEventListener('click', saveConfig)
