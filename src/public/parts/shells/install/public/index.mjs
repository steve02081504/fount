/**
 * 安装 shell 的客户端逻辑。
 */
import { showToastI18n } from '../../scripts/features/toast.mjs'
import { initTranslations, geti18n } from '../../scripts/i18n/index.mjs'
import { applyTheme } from '../../scripts/theme/index.mjs'

import { importFiles, importText } from './src/endpoints.mjs'
import { renderTemplate } from './src/templates.mjs'

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

const tabs = [fileImportTab, textImportTab]

/**
 * 切换标签页（roving tabIndex + aria-selected + 面板显隐 + 焦点移动）。
 * @param {HTMLElement} active - 激活的标签。
 */
function switchTab(active) {
	for (const tab of tabs) {
		const isActive = tab === active
		tab.classList.toggle('tab-active', isActive)
		tab.setAttribute('aria-selected', String(isActive))
		tab.tabIndex = isActive ? 0 : -1
		if (isActive) tab.focus()
	}
	fileImportContent.classList.toggle('hidden', active !== fileImportTab)
	textImportContent.classList.toggle('hidden', active !== textImportTab)
}

for (const tab of tabs)
	tab.addEventListener('click', () => switchTab(tab))

document.querySelector('[role="tablist"]').addEventListener('keydown', event => {
	const currentIndex = tabs.indexOf(document.activeElement)
	if (currentIndex === -1) return
	let nextIndex
	if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length
	else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
	else return
	event.preventDefault()
	switchTab(tabs[nextIndex])
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

/**
 * 处理拖放的项目。
 * @param {DataTransferItemList} items - 拖放的项目。
 * @returns {Promise<void>}
 */
async function handleDroppedItems(items) {
	const filesToProcess = []
	for (const item of items)
		filesToProcess.push(...await traverseFileSystemHandle(
			await item.getAsFileSystemHandle()
		))
	await handleFiles(filesToProcess)
}

/**
 * 遍历文件系统句柄。
 * @param {FileSystemHandle} handle - 文件系统句柄。
 * @returns {Promise<File[]>} - 文件数组。
 */
async function traverseFileSystemHandle(handle) {
	const files = []
	switch (handle?.kind) {
		case 'file':
			files.push(await handle.getFile())
			break
		case 'directory':
			for await (const entry of handle.values())
				files.push(...await traverseFileSystemHandle(entry))
			break
	}
	return files
}

/**
 * 处理文件。
 * @param {FileList} files - 文件列表。
 * @returns {Promise<void>}
 */
async function handleFiles(files) {
	for (const file of files)
		selectedFiles.push(file)
	await renderFileList()
}

/**
 * 渲染文件列表。
 * @returns {Promise<void>}
 */
async function renderFileList() {
	fileList.replaceChildren()
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

		showToastI18n('success', 'import.alerts.importSuccess')
	}
	catch (error) {
		let errorMessage = error.message || geti18n('import.alerts.unknownError')
		if (error.errors)
			errorMessage += `\n${formatErrors(error.errors)}`

		showToastI18n('error', 'import.alerts.importFailed', { error: errorMessage })
	}
})


/**
 * 处理文件导入。
 * @returns {Promise<void>}
 */
async function handleFileImport() {
	if (!selectedFiles.length)
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
/**
 * 处理文本导入。
 * @returns {Promise<void>}
 */
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

/**
 * 格式化错误。
 * @param {any[]} errors - 错误。
 * @returns {string} - 格式化的错误。
 */
function formatErrors(errors) {
	return errors.map(err => `${geti18n('import.errors.handler')}: ${err.handler}, ${geti18n('import.errors.error')}: ${err.error}`).join(';\n')
}

await initTranslations('import')
