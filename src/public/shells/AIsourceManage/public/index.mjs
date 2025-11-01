/**
 * AI 源编辑器页面的主要逻辑。
 */
import { async_eval } from 'https://esm.sh/@steve02081504/async-eval'

import { initTranslations, setLocalizeLogic, i18nElement, console, geti18n, confirmI18n, promptI18n } from '../../scripts/i18n.mjs'
import { createJsonEditor } from '../../scripts/jsonEditor.mjs'
import { getPartList, setDefaultPart, getDefaultParts } from '../../scripts/parts.mjs'
import { svgInliner } from '../../scripts/svgInliner.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { showToast, showToastI18n } from '../../scripts/toast.mjs'

import { getConfigTemplate, getAIFile, setAIFile, deleteAIFile, addAIFile, getConfigDisplay } from './src/endpoints.mjs'

const jsonEditorContainer = document.getElementById('jsonEditor')
const generatorDisplayContainer = document.getElementById('generatorDisplay')
const disabledIndicator = document.getElementById('disabledIndicator') // 获取遮罩层元素

const fileListContainer = document.getElementById('fileList')
const generatorSelect = document.getElementById('generatorSelect')
const saveButton = document.getElementById('saveButton')
const saveStatusIcon = document.getElementById('saveStatusIcon')
const deleteButton = document.getElementById('deleteButton')
const addFileButton = document.getElementById('addFileButton')

let activeFile = null
let jsonEditor = null
let fileList = []
let generatorList = []
let isDirty = false // 标记是否有未保存的更改
let defaultParts = {} // Store default parts
/**
 * 当JSON更新时调用的回调函数。
 * @returns {number} 返回一个数字。
 */
let onJsonUpdate = () => 0

/**
 * 创建一个统一的 fetch 错误处理函数。
 * @param {string} customMessage - 用于本地化的自定义错误消息键。
 * @returns {function(Error): void} - 接收错误对象并处理它的函数。
 */
function handleFetchError(customMessage) {
	return error => {
		console.error(geti18n(customMessage, { error: error.stack }))
		showToastI18n('error', customMessage, { error: error.stack })
		throw error // Re-throw the error to be caught by the caller if needed.
	}
}

/**
 * 从服务器获取 AI 源文件列表并渲染它们。
 * @returns {Promise<void>}
 */
async function fetchFileList() {
	fileList = await getPartList('AIsources').catch(handleFetchError('aisource_editor.alerts.fetchFileListFailed'))
	renderFileList()
}

/**
 * 从服务器获取可用的生成器列表并渲染到选择框中。
 * @returns {Promise<void>}
 */
async function fetchGeneratorList() {
	generatorList = await getPartList('AIsourceGenerators').catch(handleFetchError('aisource_editor.alerts.fetchGeneratorListFailed'))
	renderGeneratorSelect()
}

/**
 * 获取默认的 parts 设置并更新 UI。
 * @returns {Promise<void>}
 */
async function fetchDefaultParts() {
	defaultParts = await getDefaultParts().catch(handleFetchError('aisource_editor.alerts.fetchDefaultsFailed'))
	updateDefaultPartDisplay()
}

/**
 * 根据 `fileList` 变量渲染文件列表 UI。
 */
function renderFileList() {
	fileListContainer.innerHTML = ''
	fileList.forEach(fileName => {
		const listItem = document.createElement('div')
		listItem.classList.add('file-list-item')
		listItem.dataset.name = fileName // Add data-name attribute

		const p = document.createElement('p')
		p.textContent = fileName
		p.classList.add('flex-grow') // Allow text to take up space
		listItem.appendChild(p)

		// Default item checkbox
		const checkboxContainer = document.createElement('div')
		checkboxContainer.classList.add('tooltip', 'tooltip-left')
		checkboxContainer.dataset.i18n = 'aisource_editor.buttons.setDefault'

		const checkbox = document.createElement('input')
		checkbox.type = 'checkbox'
		checkbox.classList.add('default-checkbox', 'checkbox', 'checkbox-primary')
		setLocalizeLogic(checkbox, ()=>{
			checkbox.setAttribute('aria-label', geti18n('aisource_editor.buttons.setDefaultForFile', { fileName }))
		})
		checkboxContainer.appendChild(checkbox)
		listItem.appendChild(checkboxContainer)

		checkbox.addEventListener('change', async event => {
			event.stopPropagation() // Prevent click from triggering loadEditor
			const isChecked = event.target.checked
			const newDefault = isChecked ? fileName : null

			try {
				await setDefaultPart('AIsources', newDefault)
				// Update local state and UI on success
				defaultParts.AIsources = newDefault
				updateDefaultPartDisplay()
			}
			catch (error) {
				handleFetchError('aisource_editor.alerts.setDefaultFailed')(error)
				// Revert checkbox on failure
				event.target.checked = !isChecked
			}
		})

		// Prevent checkbox click from triggering list item click
		checkboxContainer.addEventListener('click', event => event.stopPropagation())
		listItem.addEventListener('click', () => loadEditor(fileName))
		fileListContainer.appendChild(listItem)
	})

	updateDefaultPartDisplay() // Apply styles for default item

	const urlParams = new URLSearchParams(window.location.search)
	const fileFromURL = urlParams.get('file')

	let fileToLoad = null
	if (fileFromURL && fileList.includes(fileFromURL))
		fileToLoad = fileFromURL
	else if (fileList.length)
		fileToLoad = activeFile && fileList.includes(activeFile) ? activeFile : fileList[0]

	if (fileToLoad)
		loadEditor(fileToLoad)
}

/**
 * 更新文件列表 UI 以反映哪个文件是默认文件。
 */
function updateDefaultPartDisplay() {
	const defaultPartName = defaultParts.AIsources
	fileListContainer.querySelectorAll('.file-list-item').forEach(el => {
		const isDefault = el.dataset.name === defaultPartName
		el.classList.toggle('selected-item', isDefault)
		const checkbox = el.querySelector('.default-checkbox')
		if (checkbox) checkbox.checked = isDefault
	})
}

/**
 * 根据 `generatorList` 变量渲染生成器选择下拉列表。
 */
function renderGeneratorSelect() {
	generatorSelect.innerHTML = '<option disabled selected data-i18n="aisource_editor.generatorSelect.placeholder"></option>'
	generatorList.forEach(generator => {
		const option = document.createElement('option')
		option.value = generator
		option.textContent = generator
		generatorSelect.appendChild(option)
	})
}

/**
 * 从服务器获取指定生成器的配置模板。
 * @param {string} generatorName - 生成器的名称。
 * @returns {Promise<object|null>} - 配置模板对象，如果名称为空则返回 null。
 */
async function fetchConfigTemplate(generatorName) {
	if (!generatorName) return null
	return await getConfigTemplate(generatorName).catch(handleFetchError('aisource_editor.alerts.fetchConfigTemplateFailed'))
}

/**
 * 加载并显示指定生成器的附加 UI 和脚本。
 * @param {string} generatorName - 生成器的名称。
 * @returns {Promise<void>}
 */
async function loadGeneratorAddons(generatorName) {
	generatorDisplayContainer.innerHTML = ''
	/**
	 * 当JSON更新时调用的回调函数。
	 * @returns {number} 返回一个数字。
	 */
	onJsonUpdate = () => 0

	if (!generatorName) return

	try {
		const { html, js: displayScript } = await getConfigDisplay(generatorName)
		await initTranslations() // refresh translations for dynamic content maybe used in part i18n data
		generatorDisplayContainer.innerHTML = html
		await svgInliner(i18nElement(generatorDisplayContainer, { skip_report: true }))
		if (displayScript) {
			const eval_result = await async_eval(displayScript, { geti18n, partName: generatorName, element: generatorDisplayContainer })
			if (eval_result.error) throw eval_result.error
			onJsonUpdate = eval_result.result || (() => 0)
		}
	}
	catch (e) {
		console.error('Error loading or evaluating generator addons:', e)
		generatorDisplayContainer.innerHTML = /* html */ `<div class="text-error">Error loading generator display: ${e.message}</div>`
	}
}

/**
 * 禁用 JSON 编辑器并显示遮罩层。
 */
function disableEditor() {
	if (jsonEditor) jsonEditor.updateProps({ readOnly: true })
	disabledIndicator.classList.remove('hidden') // 显示遮罩
}

/**
 * 启用 JSON 编辑器并隐藏遮罩层。
 */
function enableEditor() {
	if (jsonEditor) jsonEditor.updateProps({ readOnly: false })
	disabledIndicator.classList.add('hidden') // 隐藏遮罩
}

/**
 * 更新 JSON 编辑器的内容并触发更新回调。
 * @param {object} data - 要设置到编辑器中的 JSON 数据。
 * @returns {Promise<void>}
 */
async function updateEditorContent(data) {
	if (jsonEditor) {
		jsonEditor.set({ json: data || {} })
		onJsonUpdate({
			data: data || {},
			containers: {
				generatorDisplay: generatorDisplayContainer,
				jsonEditor: jsonEditorContainer
			},
			editors: {
				json: jsonEditor
			}
		})
	}
}

/**
 * 加载指定文件的内容到编辑器中。
 * @param {string} fileName - 要加载的文件名。
 * @returns {Promise<void>}
 */
async function loadEditor(fileName) {
	if (!fileName) return

	if (isDirty && !confirmI18n('aisource_editor.confirm.unsavedChanges'))
		return

	const urlParams = new URLSearchParams()
	urlParams.set('file', fileName)
	const newURL = `${window.location.pathname}?${urlParams.toString()}`
	window.history.pushState({ path: newURL }, '', newURL)

	document.querySelectorAll('.file-list-item').forEach(item => item.classList.remove('active'))
	const activeItem = fileListContainer.querySelector(`.file-list-item[data-name="${fileName}"]`)
	if (activeItem) activeItem.classList.add('active')

	activeFile = fileName
	const data = await getAIFile(fileName).catch(handleFetchError('aisource_editor.alerts.fetchFileDataFailed'))
	generatorSelect.value = data.generator

	await loadGeneratorAddons(data.generator)

	if (!jsonEditor)
		jsonEditor = createJsonEditor(jsonEditorContainer, {
			label: geti18n('aisource_editor.configTitle'),
			/**
			 * 当编辑器内容更改时调用。
			 * @param {object} json - 编辑器中的 JSON 数据。
			 * @param {string} text - 编辑器中的纯文本。
			 */
			onChange: (json, text) => {
				isDirty = true
				onJsonUpdate({
					data: json || JSON.parse(text),
					containers: {
						generatorDisplay: generatorDisplayContainer,
						jsonEditor: jsonEditorContainer
					},
					editors: {
						json: jsonEditor
					}
				})
			},
			onSave: saveFile
		})

	if (!generatorSelect.value) {
		await updateEditorContent(data.config)
		disableEditor()
	}
	else {
		enableEditor()
		await updateEditorContent(data.config || await fetchConfigTemplate(generatorSelect.value))
	}
	isDirty = false
}


/**
 * 保存当前活动文件的更改。
 * @returns {Promise<void>}
 */
async function saveFile() {
	if (!activeFile) {
		showToastI18n('error', 'aisource_editor.alerts.noFileSelectedSave')
		return
	}
	if (!generatorSelect.value) {
		showToastI18n('error', 'aisource_editor.alerts.noGeneratorSelectedSave')
		return
	}
	const config = jsonEditor.get().json || JSON.parse(jsonEditor.get().text)
	const generator = generatorSelect.value

	// Show loading icon and disable button
	saveStatusIcon.src = 'https://api.iconify.design/line-md/loading-loop.svg'
	saveStatusIcon.classList.remove('hidden')
	saveButton.disabled = true

	try {
		await setAIFile(activeFile, { generator, config }).catch(handleFetchError('aisource_editor.alerts.saveFileFailed'))
		console.log('File saved successfully.')
		isDirty = false

		saveStatusIcon.src = 'https://api.iconify.design/line-md/confirm-circle.svg'
	}
	catch (error) {
		showToast('error', error.message + '\n' + error.error || error.errors?.join('\n') || '')
		console.error(error)

		saveStatusIcon.src = 'https://api.iconify.design/line-md/emoji-frown.svg'
	}

	// Hide icon and re-enable button after a delay
	setTimeout(() => {
		saveStatusIcon.classList.add('hidden')
		saveButton.disabled = false
	}, 2000) // 2 seconds delay
}

/**
 * 删除当前活动文件。
 * @returns {Promise<void>}
 */
async function deleteFile() {
	if (!activeFile) {
		showToastI18n('error', 'aisource_editor.alerts.noFileSelectedDelete')
		return
	}
	if (!confirmI18n('aisource_editor.confirm.deleteFile')) return

	await deleteAIFile(activeFile).catch(handleFetchError('aisource_editor.alerts.deleteFileFailed'))
	console.log('File delete successfully.')
	activeFile = null
	await fetchFileList()

	//  不清空 jsonEditor，而是禁用并清空
	if (!fileList.length) {
		updateEditorContent({})
		disableEditor()
	}
}

/**
 * 添加一个新的 AI 源文件。
 * @returns {Promise<void>}
 */
async function addFile() {
	const newFileName = promptI18n('aisource_editor.prompts.newFileName')
	if (!newFileName) return

	if (!isValidFileName(newFileName)) {
		showToastI18n('error', 'aisource_editor.alerts.invalidFileName')
		return
	}

	await addAIFile(newFileName).catch(handleFetchError('aisource_editor.alerts.addFileFailed'))
	await fetchFileList()

	await loadEditor(newFileName)
	console.log('File add successfully.')
}

/**
 * 验证文件名是否有效。
 * @param {string} fileName - 要验证的文件名。
 * @returns {boolean} - 如果文件名有效则返回 true，否则返回 false。
 */
function isValidFileName(fileName) {
	const invalidChars = /["*/:<>?\\|]/
	return !invalidChars.test(fileName)
}

// Initialization
applyTheme()
await initTranslations('aisource_editor')
disableEditor()

fetchFileList()
fetchGeneratorList()
fetchDefaultParts()

saveButton.addEventListener('click', saveFile)
deleteButton.addEventListener('click', deleteFile)
addFileButton.addEventListener('click', addFile)

generatorSelect.addEventListener('change', async () => {
	const selectedGenerator = generatorSelect.value
	await loadGeneratorAddons(selectedGenerator)
	if (selectedGenerator) {
		const template = await fetchConfigTemplate(selectedGenerator)
		updateEditorContent(template)
		enableEditor()
	}
	else
		disableEditor()
})

window.addEventListener('beforeunload', event => {
	if (isDirty) {
		event.preventDefault()
		event.returnValue = geti18n('aisource_editor.confirm.unsavedChangesBeforeUnload')
	}
})

window.addEventListener('popstate', () => {
	const urlParams = new URLSearchParams(window.location.search)
	const fileFromURL = urlParams.get('file')
	if (fileFromURL && fileList.includes(fileFromURL))
		loadEditor(fileFromURL)
})
