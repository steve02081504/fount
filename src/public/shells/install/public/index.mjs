import { initTranslations, geti18n } from '../../scripts/i18n.mjs'
import { renderTemplate, usingTemplates } from '../../scripts/template.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { showToast } from '../../scripts/toast.mjs'

import { importFiles, importText } from './src/endpoints.mjs'

usingTemplates('/shells/install/src/templates')
applyTheme()

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
dropArea.addEventListener('dragover', event => {
	event.preventDefault()
	dropArea.classList.add('dragover')
})

dropArea.addEventListener('dragleave', () => {
	dropArea.classList.remove('dragover')
})

dropArea.addEventListener('drop', async event => {
	event.preventDefault()
	dropArea.classList.remove('dragover')
	await handleDroppedItems(event.dataTransfer.items)
})

// 点击选择文件
dropArea.addEventListener('click', () => {
	const input = document.createElement('input')
	input.type = 'file'
	input.multiple = true
	input.addEventListener('change', async event => {
		await handleFiles(event.target.files)
	})
	input.click()
})

// 递归处理拖放的文件和文件夹
async function handleDroppedItems(items) {
	const filesToProcess = []
	for (const item of items) {
		const entry = item.webkitGetAsEntry()
		if (entry) {
			const files = await traverseFileTree(entry)
			filesToProcess.push(...files)
		}
	}
	await handleFiles(filesToProcess)
}

// 遍历文件树（处理文件夹）
async function traverseFileTree(entry) {
	return new Promise(resolve => {
		if (entry.isFile)
			entry.file(file => resolve([file]))
		else if (entry.isDirectory) {
			const directoryReader = entry.createReader()
			directoryReader.readEntries(async entries => {
				const files = []
				for (const subEntry of entries)
					files.push(...await traverseFileTree(subEntry))

				resolve(files)
			})
		}
	})
}

// 文件处理函数
async function handleFiles(files) {
	for (const file of files)
		selectedFiles.push(file)
	await renderFileList()
}

// 渲染文件列表
async function renderFileList() {
	fileList.innerHTML = ''
	for (const file of selectedFiles) {
		const fileItem = await renderTemplate('import_file_item', { fileName: file.name })
		fileList.appendChild(fileItem)

		fileItem.querySelector('.remove-file-button').addEventListener('click', async () => {
			selectedFiles = selectedFiles.filter(f => f.name !== file.name)
			await renderFileList()
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

		showToast(geti18n('import.alerts.importSuccess'), 'success')
	}
	catch (error) {
		let errorMessage = error.message || geti18n('import.alerts.unknownError')
		if (error.errors)
			errorMessage += `\n${formatErrors(error.errors)}`

		showToast(geti18n('import.alerts.importFailed', { error: errorMessage }), 'error')
	}
})


async function handleFileImport() {
	if (selectedFiles.length === 0)
		throw new Error(geti18n('import.errors.noFileSelected'))

	const formData = new FormData()
	for (const file of selectedFiles)
		formData.append('files', file)

	const response = await importFiles(formData)

	if (!response.ok) {
		const result = await response.json()
		const error = new Error(geti18n('import.errors.fileImportFailed', { message: result.message || geti18n('import.errors.unknownError') }))
		error.errors = result.errors
		throw error
	}
}
async function handleTextImport() {
	const text = textInput.value
	if (!text)
		throw new Error(geti18n('import.errors.noTextContent'))

	const response = await importText(text)

	if (!response.ok) {
		const result = await response.json()
		const error = new Error(geti18n('import.errors.textImportFailed', { message: result.message || geti18n('import.errors.unknownError') }))
		error.errors = result.errors
		throw error
	}
}

function formatErrors(errors) {
	return errors.map(err => `${geti18n('import.errors.handler')}: ${err.handler}, ${geti18n('import.errors.error')}: ${err.error}`).join(';\n')
}

await initTranslations('import')
