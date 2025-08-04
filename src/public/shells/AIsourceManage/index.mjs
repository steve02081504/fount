import { async_eval } from 'https://esm.sh/@steve02081504/async-eval'

import { initTranslations, i18nElement, console, geti18n, confirmI18n, promptI18n } from '../../scripts/i18n.mjs'
import { createJsonEditor } from '../../scripts/jsonEditor.mjs'
import { getPartList, setDefaultPart, getDefaultParts } from '../../scripts/parts.mjs'
import { svgInliner } from '../../scripts/svgInliner.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { showToast } from '../../scripts/toast.mjs'

import { getConfigTemplate, getAIFile, setAIFile, deleteAIFile, addAIFile, getConfigDisplay } from './src/public/endpoints.mjs'


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
let onJsonUpdate = () => 0

// 统一的错误处理函数
function handleFetchError(customMessage) {
	return (error) => {
		const text = geti18n(customMessage, { error: error.stack })
		console.error(text)
		showToast(text, 'error')
		throw error // Re-throw the error to be caught by the caller if needed.
	}
}

async function fetchFileList() {
	fileList = await getPartList('AIsources').catch(handleFetchError('aisource_editor.alerts.fetchFileListFailed'))
	renderFileList()
}

async function fetchGeneratorList() {
	generatorList = await getPartList('AIsourceGenerators').catch(handleFetchError('aisource_editor.alerts.fetchGeneratorListFailed'))
	renderGeneratorSelect()
}

async function fetchDefaultParts() {
	defaultParts = await getDefaultParts().catch(handleFetchError('aisource_editor.alerts.fetchDefaultsFailed'))
	updateDefaultPartDisplay()
}

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
		checkboxContainer.dataset.tip = geti18n('aisource_editor.tooltips.setDefault')

		const checkbox = document.createElement('input')
		checkbox.type = 'checkbox'
		checkbox.classList.add('default-checkbox', 'checkbox', 'checkbox-primary')
		checkboxContainer.appendChild(checkbox)
		listItem.appendChild(checkboxContainer)

		checkbox.addEventListener('change', async (event) => {
			event.stopPropagation() // Prevent click from triggering loadEditor
			const isChecked = event.target.checked
			const newDefault = isChecked ? fileName : null

			try {
				await setDefaultPart('AIsources', newDefault)
				// Update local state and UI on success
				defaultParts.AIsources = newDefault
				updateDefaultPartDisplay()
			} catch (error) {
				handleFetchError('aisource_editor.alerts.setDefaultFailed')(error)
				// Revert checkbox on failure
				event.target.checked = !isChecked
			}
		})

		// Prevent checkbox click from triggering list item click
		checkboxContainer.addEventListener('click', (event) => event.stopPropagation())
		listItem.addEventListener('click', () => loadEditor(fileName))
		fileListContainer.appendChild(listItem)
	})

	updateDefaultPartDisplay() // Apply styles for default item

	const urlParams = new URLSearchParams(window.location.search)
	const fileFromURL = urlParams.get('file')

	let fileToLoad = null
	if (fileFromURL && fileList.includes(fileFromURL))
		fileToLoad = fileFromURL
	else if (fileList.length > 0)
		fileToLoad = activeFile && fileList.includes(activeFile) ? activeFile : fileList[0]

	if (fileToLoad)
		loadEditor(fileToLoad)
}

function updateDefaultPartDisplay() {
	const defaultPartName = defaultParts.AIsources
	fileListContainer.querySelectorAll('.file-list-item').forEach(el => {
		const isDefault = el.dataset.name === defaultPartName
		el.classList.toggle('selected-item', isDefault)
		const checkbox = el.querySelector('.default-checkbox')
		if (checkbox) checkbox.checked = isDefault
	})
}

function renderGeneratorSelect() {
	generatorSelect.innerHTML = '<option disabled selected data-i18n="aisource_editor.generatorSelect.placeholder"></option>'
	generatorList.forEach(generator => {
		const option = document.createElement('option')
		option.value = generator
		option.textContent = generator
		generatorSelect.appendChild(option)
	})
}

async function fetchConfigTemplate(generatorName) {
	if (!generatorName) return null
	return await getConfigTemplate(generatorName).catch(handleFetchError('aisource_editor.alerts.fetchConfigTemplateFailed'))
}

async function loadGeneratorAddons(generatorName) {
	generatorDisplayContainer.innerHTML = ''
	onJsonUpdate = () => 0

	if (!generatorName) return

	try {
		const { html, js: displayScript } = await getConfigDisplay(generatorName)
		generatorDisplayContainer.innerHTML = html
		await svgInliner(i18nElement(generatorDisplayContainer))
		if (displayScript) {
			const eval_result = await async_eval(displayScript, { geti18n })
			if (eval_result.error) throw eval_result.error
			onJsonUpdate = eval_result.result
		}
	} catch (e) {
		console.error('Error loading or evaluating generator addons:', e)
		generatorDisplayContainer.innerHTML = `<div class="text-error">Error loading generator display: ${e.message}</div>`
	}
}

function disableEditor() {
	if (jsonEditor) jsonEditor.updateProps({ readOnly: true })
	disabledIndicator.classList.remove('hidden') // 显示遮罩
}

function enableEditor() {
	if (jsonEditor) jsonEditor.updateProps({ readOnly: false })
	disabledIndicator.classList.add('hidden') // 隐藏遮罩
}

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
			onChange: () => {
				isDirty = true
				onJsonUpdate({
					data: jsonEditor.get().json || JSON.parse(jsonEditor.get().text),
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


async function saveFile() {
	if (!activeFile) {
		showToast(geti18n('aisource_editor.alerts.noFileSelectedSave'), 'error')
		return
	}
	if (!generatorSelect.value) {
		showToast(geti18n('aisource_editor.alerts.noGeneratorSelectedSave'), 'error')
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
	} catch (error) {
		showToast(error.message + '\n' + error.error || error.errors?.join('\n') || '', 'error')
		console.error(error)

		saveStatusIcon.src = 'https://api.iconify.design/line-md/emoji-frown.svg'
	}

	// Hide icon and re-enable button after a delay
	setTimeout(() => {
		saveStatusIcon.classList.add('hidden')
		saveButton.disabled = false
	}, 2000) // 2 seconds delay
}

async function deleteFile() {
	if (!activeFile) {
		showToast(geti18n('aisource_editor.alerts.noFileSelectedDelete'), 'error')
		return
	}
	if (!confirmI18n('aisource_editor.confirm.deleteFile')) return

	await deleteAIFile(activeFile).catch(handleFetchError('aisource_editor.alerts.deleteFileFailed'))
	console.log('File delete successfully.')
	activeFile = null
	await fetchFileList()

	//  不清空 jsonEditor，而是禁用并清空
	if (fileList.length === 0) {
		updateEditorContent({})
		disableEditor()
	}
}

async function addFile() {
	const newFileName = promptI18n('aisource_editor.prompts.newFileName')
	if (!newFileName) return

	if (!isValidFileName(newFileName)) {
		showToast(geti18n('aisource_editor.alerts.invalidFileName'), 'error')
		return
	}

	await addAIFile(newFileName).catch(handleFetchError('aisource_editor.alerts.addFileFailed'))
	await fetchFileList()

	await loadEditor(newFileName)
	console.log('File add successfully.')
}

function isValidFileName(fileName) {
	const invalidChars = /["*/:<>?\\|]/
	return !invalidChars.test(fileName)
}

// Initialization
applyTheme()
initTranslations('aisource_editor')
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

window.addEventListener('beforeunload', (event) => {
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
