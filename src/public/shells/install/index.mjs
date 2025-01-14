import { renderTemplate } from '../../scripts/template.mjs'

const fileImportTab = document.getElementById('file-import-tab')
const textImportTab = document.getElementById('text-import-tab')
const fileImportContent = document.getElementById('file-import-content')
const textImportContent = document.getElementById('text-import-content')
const dropArea = document.getElementById('drop-area')
const fileList = document.getElementById('file-list')
const textInput = document.getElementById('text-input')
const importButton = document.getElementById('import-button')

let selectedFiles = []

// 切换标签页
fileImportTab.addEventListener('click', () => {
	fileImportTab.classList.add('tab-active')
	textImportTab.classList.remove('tab-active')
	fileImportContent.classList.remove('hidden')
	textImportContent.classList.add('hidden')
})

textImportTab.addEventListener('click', () => {
	textImportTab.classList.add('tab-active')
	fileImportTab.classList.remove('tab-active')
	textImportContent.classList.remove('hidden')
	fileImportContent.classList.add('hidden')
})

// 文件拖放处理
dropArea.addEventListener('dragover', (event) => {
	event.preventDefault()
	dropArea.classList.add('dragover')
})

dropArea.addEventListener('dragleave', () => {
	dropArea.classList.remove('dragover')
})

dropArea.addEventListener('drop', (event) => {
	event.preventDefault()
	dropArea.classList.remove('dragover')
	handleFiles(event.dataTransfer.files)
})

// 点击选择文件
dropArea.addEventListener('click', () => {
	const input = document.createElement('input')
	input.type = 'file'
	input.multiple = true
	input.addEventListener('change', (event) => {
		handleFiles(event.target.files)
	})
	input.click()
})

// 文件处理函数
function handleFiles(files) {
	for (const file of files)
		if (!selectedFiles.find(f => f.name === file.name))
			selectedFiles.push(file)

	renderFileList()
}

// 渲染文件列表
async function renderFileList() {
	fileList.innerHTML = ''
	for (const file of selectedFiles) {
		const fileItem = await renderTemplate('import_file_item', { fileName: file.name })
		fileList.appendChild(fileItem)

		fileItem.querySelector('.remove-file-button').addEventListener('click', (event) => {
			const fileName = event.target.dataset.filename
			selectedFiles = selectedFiles.filter(f => f.name !== fileName)
			renderFileList()
		})
	}
}

// 导入按钮点击事件
importButton.addEventListener('click', async () => {
	const isFileImport = !fileImportContent.classList.contains('hidden')
	try {
		if (isFileImport)
			await handleFileImport()
		else
			await handleTextImport()

		alert('导入成功')
	} catch (error) {
		let errorMessage = error.message || 'Unknown error'
		if (error.errors)
			errorMessage += `\n${formatErrors(error.errors)}`

		alert(`导入失败: ${errorMessage}`)
	}
})


async function handleFileImport() {
	if (selectedFiles.length === 0)
		throw new Error('请选择文件')

	const formData = new FormData()
	for (const file of selectedFiles)
		formData.append('files', file)

	const response = await fetch('/api/shells/install/file', {
		method: 'POST',
		body: formData
	})

	if (!response.ok) {
		const result = await response.json()
		const error = new Error(`文件导入失败: ${result.message || 'Unknown error'}`)
		error.errors = result.errors
		throw error
	}
}
async function handleTextImport() {
	const text = textInput.value
	if (!text)
		throw new Error('请输入文本内容')

	const response = await fetch('/api/shells/install/text', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ text })
	})

	if (!response.ok) {
		const result = await response.json()
		const error = new Error(`文本导入失败: ${result.message || 'Unknown error'}`)
		error.errors = result.errors
		throw error
	}
}

function formatErrors(errors) {
	return errors.map(err => `handler: ${err.hanlder}, Error: ${err.error}`).join(';\n')
}
