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

async function fetchFileList() {
	try {
		const response = await fetch('/api/getlist/AIsources')
		if (!response.ok)
			throw new Error(`HTTP error! status: ${response.status}`)

		fileList = await response.json()
		renderFileList()
	} catch (error) {
		console.error('Failed to fetch file list:', error)
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
	if (fileList.length > 0)
		loadEditor(fileList[0])

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
	// 更新高亮
	document.querySelectorAll('.file-list-item').forEach(item => {
		item.classList.remove('active')
	})
	const fileItem = document.querySelector(`#fileList .file-list-item:nth-child(${fileList.indexOf(fileName) + 1})`)

	fileItem.classList.add('active')
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
			jsonEditor = createJSONEditor({
				target: jsonEditorContainer,
				props: {
					mode: 'code',
					indentation: '\t'
				}
			})
		jsonEditor.set({ json: data.config })
	} catch (error) {
		console.error('Failed to fetch file data:', error)
	}
}

async function saveFile() {
	if (!activeFile) {
		console.warn('No file selected to save.')
		return
	}
	const config = jsonEditor.get().json
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
		await fetchFileList()
	} catch (error) {
		console.error('Failed to save file:', error)
	}
}

async function deleteFile() {
	if (!activeFile) {
		console.warn('No file selected to delete')
		return
	}
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
		jsonEditor.destroy()
		jsonEditor = null
		await fetchFileList()
	} catch (error) {
		console.error('Failed to delete file:', error)
	}
}

async function addFile() {
	const newFileName = prompt('请输入新的 AI 来源文件名 (请勿包含后缀名):')
	if (!newFileName) return

	try {
		const response = await fetch('/api/shells/AIsourceManage/addfile', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ AISourceFile: newFileName + '.json' }),
		})
		if (!response.ok)
			throw new Error(`HTTP error! status: ${response.status}`)
		await fetchFileList()
		console.log('File add successfully.')
	} catch (error) {
		console.error('Failed to add file:', error)
	}

}
// 初始化
fetchFileList()
fetchGeneratorList()
saveButton.addEventListener('click', saveFile)
deleteButton.addEventListener('click', () => {
	if (confirm('确定要删除文件吗?'))
		deleteFile()
})
addFileButton.addEventListener('click', addFile)
