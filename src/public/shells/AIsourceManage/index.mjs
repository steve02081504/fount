import { createJSONEditor } from 'https://cdn.jsdelivr.net/npm/vanilla-jsoneditor@2/standalone.js'
import { applyTheme } from '../../scripts/theme.mjs'

const jsonEditorContainer = document.getElementById('jsonEditor')
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
		alert('Failed to fetch file list: ' + error.message)
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
		alert('Failed to fetch generator list: ' + error.message)
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
	generatorSelect.innerHTML = '<option disabled selected>请选择</option>'
	generatorList.forEach(generator => {
		const option = document.createElement('option')
		option.value = generator
		option.textContent = generator
		generatorSelect.appendChild(option)
	})
}

async function loadEditor(fileName) {
	if (!fileName) return

	// 如果有未保存的更改，提示用户
	if (isDirty)
		if (!confirm('You have unsaved changes. Do you want to discard them?'))
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
		generatorSelect.value = data.generator || ''

		if (!jsonEditor)
			jsonEditor = createJSONEditor({
				target: jsonEditorContainer,
				props: {
					mode: 'code',
					indentation: '\t',
					onChange: (updatedContent, previousContent, { error, patchResult }) => {
						isDirty = true // 标记为有未保存的更改
					},
				}
			})

		jsonEditor.set({ json: data.config })
		isDirty = false // 重置未保存标记
	} catch (error) {
		console.error('Failed to fetch file data:', error)
		alert('Failed to fetch file data: ' + error.message)
	}
}

async function saveFile() {
	if (!activeFile) {
		alert('No file selected to save.')
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
		alert('Failed to save file: ' + error.message)
	}
}

async function deleteFile() {
	if (!activeFile) {
		alert('No file selected to delete')
		return
	}
	if (!confirm('确定要删除文件吗?'))
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

		await fetchFileList()
		activeFile = fileList.length > 0 ? fileList[0] : null
		if (activeFile)
			loadEditor(activeFile)
		else
			if (jsonEditor) {
				jsonEditor.destroy()
				jsonEditor = null
			}

	} catch (error) {
		console.error('Failed to delete file:', error)
		alert('Failed to delete file: ' + error.message)
	}
}

async function addFile() {
	const newFileName = prompt('请输入新的 AI 来源文件名 (请勿包含后缀名):')
	if (!newFileName) return

	try {
		const newFileFullName = newFileName + '.json'
		const response = await fetch('/api/shells/AIsourceManage/addfile', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ AISourceFile: newFileFullName }),
		})
		if (!response.ok)
			throw new Error(`HTTP error! status: ${response.status}`)
		await fetchFileList()
		console.log('File add successfully.')
		loadEditor(newFileFullName)
	} catch (error) {
		console.error('Failed to add file:', error)
		alert('Failed to add file: ' + error.message)
	}
}

// 初始化
fetchFileList()
fetchGeneratorList()

saveButton.addEventListener('click', saveFile)
deleteButton.addEventListener('click', deleteFile)
addFileButton.addEventListener('click', addFile)

// 离开页面时提醒
window.addEventListener('beforeunload', (event) => {
	if (isDirty) {
		event.preventDefault()
		event.returnValue = 'You have unsaved changes. Are you sure you want to leave?'
	}
})
