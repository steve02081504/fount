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
importButton.addEventListener('click', () => {
	const isFileImport = !fileImportContent.classList.contains('hidden')
	if (isFileImport)
		// 处理文件导入逻辑
		console.log('导入文件:', selectedFiles)
	else
		// 处理文本导入逻辑
		console.log('导入文本:', textInput.value)

	// 在这里调用你的导入函数入口
})
