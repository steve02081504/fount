import { createJsonEditor } from '../../scripts/jsoneditor.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { initTranslations, geti18n } from '../../scripts/i18n.mjs'

const jsonEditorContainer = document.getElementById('jsonEditor')
const disabledIndicator = document.getElementById('disabledIndicator') // 获取遮罩层元素
if (applyTheme()) jsonEditorContainer.classList.add('jse-theme-dark')

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

async function fetchFileList() {
	try {
		const response = await fetch('/api/getlist/AIsources')
		if (!response.ok)
			throw new Error(`HTTP error! status: ${response.status}`)

		fileList = await response.json()
		renderFileList()
	} catch (error) {
		console.error('Failed to fetch file list:', error)
		alert(geti18n('aisource_editor.alerts.fetchFileListFailed', { error: error.message }))
	}
}

async function fetchGeneratorList() {
	try {
		const response = await fetch('/api/getlist/AIsourceGenerators')
		if (!response.ok)
			throw new Error(`HTTP error! status: ${response.status}`)

		generatorList = await response.json()
		renderGeneratorSelect()
	} catch (error) {
		console.error('Failed to fetch generator list:', error)
		alert(geti18n('aisource_editor.alerts.fetchGeneratorListFailed', { error: error.message }))
	}
}

function renderFileList() {
	fileListDiv.innerHTML = ''
	fileList.forEach((fileName, index) => {
		const listItem = document.createElement('div')
		listItem.classList.add('file-list-item')
		const p = document.createElement('p')
		p.textContent = fileName
		listItem.appendChild(p)
		listItem.addEventListener('click', () => loadEditor(fileName))

		fileListDiv.appendChild(listItem)
	})
	if (fileList.length > 0 && !activeFile)
		loadEditor(fileList[0])
	else if (fileList.length > 0 && activeFile)
		loadEditor(activeFile)

}

function renderGeneratorSelect() {
	generatorSelect.innerHTML = '<option disabled selected data-i18n="aisource_editor.generatorSelect.placeholder"></option>' // 占位符已在 HTML 中处理
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
		const response = await fetch('/api/shells/AIsourceManage/getConfigTemplate', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ generator: generatorName }),
		})
		if (!response.ok) {
			const message = await response.text()
			throw new Error(`HTTP error! status: ${response.status}, message: ${message}`)
		}
		return await response.json()
	} catch (error) {
		console.error('Failed to fetch config template:', error)
		alert(geti18n('aisource_editor.alerts.fetchConfigTemplateFailed', { error: error.message }))
		return null // 允许用户继续编辑
	}
}

function disableEditor() {
	if (jsonEditor) {
		jsonEditor.set({ json: {} }) // 清空编辑器内容
		jsonEditor.updateProps({ readOnly: true })
	}
	disabledIndicator.classList.remove('hidden') // 显示遮罩
}

function enableEditor() {
	if (jsonEditor)
		jsonEditor.updateProps({ readOnly: false })

	disabledIndicator.classList.add('hidden') // 隐藏遮罩
}


async function loadEditor(fileName) {
	if (!fileName) return

	// 如果有未保存的更改，提示用户
	if (isDirty)
		if (!confirm(geti18n('aisource_editor.confirm.unsavedChanges')))
			return

	// 更新高亮
	document.querySelectorAll('.file-list-item').forEach(item => {
		item.classList.remove('active')
	})
	const activeItemIndex = fileList.indexOf(fileName)
	if (activeItemIndex !== -1) {
		const fileItem = document.querySelector(`#fileList .file-list-item:nth-child(${activeItemIndex + 1})`)
		if (fileItem)
			fileItem.classList.add('active')
	}

	activeFile = fileName
	try {
		const response = await fetch('/api/shells/AIsourceManage/getfile', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ AISourceFile: fileName }),
		})
		if (!response.ok)
			throw new Error(`HTTP error! status: ${response.status}`)

		const data = await response.json()
		generatorSelect.value = data.generator

		if (!jsonEditor)
			jsonEditor = createJsonEditor(jsonEditorContainer, {
				onChange: (updatedContent, previousContent, { error, patchResult }) => {
					isDirty = true // 标记为有未保存的更改
				},
				onSave: saveFile
			})

		if (!generatorSelect.value) {
			disableEditor()
			jsonEditor.set({ json: {} })
		}
		else {
			enableEditor()
			const template = await fetchConfigTemplate(generatorSelect.value)
			jsonEditor.set({ json: data.config || template || {} })
		}

		isDirty = false // 重置未保存标记
	} catch (error) {
		console.error('Failed to fetch file data:', error)
		alert(geti18n('aisource_editor.alerts.fetchFileDataFailed', { error: error.message }))
	}
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
	try {
		const response = await fetch('/api/shells/AIsourceManage/setfile', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				AISourceFile: activeFile,
				data: {
					generator,
					config
				}
			}),
		})
		if (!response.ok)
			throw new Error(`HTTP error! status: ${response.status}`)

		console.log('File saved successfully.')
		isDirty = false // 重置未保存标记
	} catch (error) {
		console.error('Failed to save file:', error)
		alert(geti18n('aisource_editor.alerts.saveFileFailed', { error: error.message }))
	}
}

async function deleteFile() {
	if (!activeFile) {
		alert(geti18n('aisource_editor.alerts.noFileSelectedDelete'))
		return
	}
	if (!confirm(geti18n('aisource_editor.confirm.deleteFile')))
		return

	try {
		const response = await fetch('/api/shells/AIsourceManage/deletefile', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ AISourceFile: activeFile }),
		})
		if (!response.ok)
			throw new Error(`HTTP error! status: ${response.status}`)

		console.log('File delete successfully.')

		activeFile = null
		await fetchFileList()
		if (fileList.length > 0)
			loadEditor(fileList[0])
		else if (jsonEditor) {
			jsonEditor.destroy()
			jsonEditor = null
		}

	} catch (error) {
		console.error('Failed to delete file:', error)
		alert(geti18n('aisource_editor.alerts.deleteFileFailed', { error: error.message }))
	}
}

async function addFile() {
	const newFileName = prompt(geti18n('aisource_editor.prompts.newFileName'))
	if (!newFileName) return

	// 验证文件名是否有效
	if (!isValidFileName(newFileName)) {
		alert(geti18n('aisource_editor.alerts.invalidFileName'))
		return
	}

	try {
		const response = await fetch('/api/shells/AIsourceManage/addfile', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ AISourceFile: newFileName }),
		})
		if (!response.ok)
			throw new Error(`HTTP error! status: ${response.status}`)
		await fetchFileList()

		await loadEditor(newFileName)
		console.log('File add successfully.')
	} catch (error) {
		console.error('Failed to add file:', error)
		alert(geti18n('aisource_editor.alerts.addFileFailed', { error: error.message }))
	}
}

function isValidFileName(fileName) {
	const invalidChars = /["*/:<>?\\|]/
	return !invalidChars.test(fileName)
}

// 初始化
fetchFileList()
fetchGeneratorList()
initTranslations('aisource_editor')
disableEditor() // 初始禁用编辑器

saveButton.addEventListener('click', saveFile)
deleteButton.addEventListener('click', deleteFile)
addFileButton.addEventListener('click', addFile)

generatorSelect.addEventListener('change', async () => {
	const selectedGenerator = generatorSelect.value
	if (selectedGenerator) {
		enableEditor()
		const template = await fetchConfigTemplate(selectedGenerator)
		if (template && jsonEditor)
			jsonEditor.set({ json: template })
	}
	else {
		disableEditor()
		jsonEditor.set({ json: {} })
	}
})

// 离开页面时提醒
window.addEventListener('beforeunload', (event) => {
	if (isDirty) {
		event.preventDefault()
		event.returnValue = geti18n('aisource_editor.confirm.unsavedChangesBeforeUnload')
	}
})
