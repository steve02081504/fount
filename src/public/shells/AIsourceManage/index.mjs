import { createJsonEditor } from '../../scripts/jsoneditor.mjs'
import { applyTheme, onThemeChange } from '../../scripts/theme.mjs'
import { initTranslations, geti18n } from '../../scripts/i18n.mjs'

const jsonEditorContainer = document.getElementById('jsonEditor')
const disabledIndicator = document.getElementById('disabledIndicator') // 获取遮罩层元素
onThemeChange(
	(theme, isDark) => {
		if (isDark) jsonEditorContainer.classList.add('jse-theme-dark')
		else jsonEditorContainer.classList.remove('jse-theme-dark')
	}
)

const fileListDiv = document.getElementById('fileList')
const generatorSelect = document.getElementById('generatorSelect')
const saveButton = document.getElementById('saveButton')
const deleteButton = document.getElementById('deleteButton')
const addFileButton = document.getElementById('addFileButton')

let activeFile = null
let jsonEditor = null
let fileList = []
let generatorList = []
let isDirty = false // 标记是否有未保存的更改

// 统一的错误处理函数
async function handleFetchError(response, customMessage) {
	if (!response.ok) {
		const message = await response.text()
		const error = new Error(`HTTP error! status: ${response.status}, message: ${message}`)
		console.error(customMessage, error)
		alert(geti18n(customMessage, { error: error.message }))
		throw error // Re-throw the error to be caught by the caller if needed.
	}
	return response
}

async function fetchFileList() {
	const response = await fetch('/api/getlist/AIsources')
	await handleFetchError(response, 'aisource_editor.alerts.fetchFileListFailed')
	fileList = await response.json()
	renderFileList()
}

async function fetchGeneratorList() {
	const response = await fetch('/api/getlist/AIsourceGenerators')
	await handleFetchError(response, 'aisource_editor.alerts.fetchGeneratorListFailed')
	generatorList = await response.json()
	renderGeneratorSelect()
}

function renderFileList() {
	fileListDiv.innerHTML = ''
	fileList.forEach(fileName => {
		const listItem = document.createElement('div')
		listItem.classList.add('file-list-item')
		const p = document.createElement('p')
		p.textContent = fileName
		listItem.appendChild(p)
		listItem.addEventListener('click', () => loadEditor(fileName))
		fileListDiv.appendChild(listItem)
	})

	if (fileList.length > 0) {
		const fileToLoad = activeFile && fileList.includes(activeFile) ? activeFile : fileList[0]
		loadEditor(fileToLoad)
	}
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
	try {
		const response = await fetch(`/api/shells/AIsourceManage/getConfigTemplate?${new URLSearchParams({ generator: generatorName })}`)
		await handleFetchError(response, 'aisource_editor.alerts.fetchConfigTemplateFailed')
		return await response.json()
	} catch (error) {
		return null // 允许用户继续编辑
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
	if (jsonEditor) jsonEditor.set({ json: data || {} })
}

async function loadEditor(fileName) {
	if (!fileName) return

	if (isDirty && !confirm(geti18n('aisource_editor.confirm.unsavedChanges')))
		return

	document.querySelectorAll('.file-list-item').forEach(item => item.classList.remove('active'))
	const activeItemIndex = fileList.indexOf(fileName)
	if (activeItemIndex !== -1) {
		const fileItem = document.querySelector(`#fileList .file-list-item:nth-child(${activeItemIndex + 1})`)
		if (fileItem) fileItem.classList.add('active')
	}

	activeFile = fileName
	const response = await fetch(`/api/shells/AIsourceManage/getfile?${new URLSearchParams({ AISourceFile: fileName })}`)
	await handleFetchError(response, 'aisource_editor.alerts.fetchFileDataFailed')
	const data = await response.json()
	generatorSelect.value = data.generator

	if (!jsonEditor)
		jsonEditor = createJsonEditor(jsonEditorContainer, {
			onChange: () => { isDirty = true },
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
		alert(geti18n('aisource_editor.alerts.noFileSelectedSave'))
		return
	}
	if (!generatorSelect.value) {
		alert(geti18n('aisource_editor.alerts.noGeneratorSelectedSave'))
		return
	}
	const config = jsonEditor.get().json || JSON.parse(jsonEditor.get().text)
	const generator = generatorSelect.value
	const response = await fetch('/api/shells/AIsourceManage/setfile', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			AISourceFile: activeFile,
			data: { generator, config }
		}),
	})
	await handleFetchError(response, 'aisource_editor.alerts.saveFileFailed')
	console.log('File saved successfully.')
	isDirty = false
}

async function deleteFile() {
	if (!activeFile) {
		alert(geti18n('aisource_editor.alerts.noFileSelectedDelete'))
		return
	}
	if (!confirm(geti18n('aisource_editor.confirm.deleteFile'))) return

	const response = await fetch('/api/shells/AIsourceManage/deletefile', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ AISourceFile: activeFile }),
	})
	await handleFetchError(response, 'aisource_editor.alerts.deleteFileFailed')
	console.log('File delete successfully.')
	activeFile = null
	await fetchFileList()

	//  不清空 jsonEditor，而是禁用并清空
	if (fileList.length === 0)
		disableEditor()
}

async function addFile() {
	const newFileName = prompt(geti18n('aisource_editor.prompts.newFileName'))
	if (!newFileName) return

	if (!isValidFileName(newFileName)) {
		alert(geti18n('aisource_editor.alerts.invalidFileName'))
		return
	}

	const response = await fetch('/api/shells/AIsourceManage/addfile', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ AISourceFile: newFileName }),
	})
	await handleFetchError(response, 'aisource_editor.alerts.addFileFailed')
	await fetchFileList()

	await loadEditor(newFileName)
	console.log('File add successfully.')
}

function isValidFileName(fileName) {
	const invalidChars = /["*/:<>?\\|]/
	return !invalidChars.test(fileName)
}

// 初始化
applyTheme()
fetchFileList()
fetchGeneratorList()
initTranslations('aisource_editor')
disableEditor()

saveButton.addEventListener('click', saveFile)
deleteButton.addEventListener('click', deleteFile)
addFileButton.addEventListener('click', addFile)

generatorSelect.addEventListener('change', async () => {
	const selectedGenerator = generatorSelect.value
	if (selectedGenerator) {
		const template = await fetchConfigTemplate(selectedGenerator)
		updateEditorContent(template)
	}
	else
		disableEditor()
	enableEditor() //无论如何都调用

})

window.addEventListener('beforeunload', (event) => {
	if (isDirty) {
		event.preventDefault()
		event.returnValue = geti18n('aisource_editor.confirm.unsavedChangesBeforeUnload')
	}
})
