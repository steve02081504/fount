import { renderTemplate } from '../../../../scripts/template.mjs'
import { processTimeStampForId, arrayBufferToBase64 } from './utils.mjs'
import { openModal } from './ui/modal.mjs'

export const fileInputElement = document.getElementById('file-input')
export const attachmentPreviewContainer = document.getElementById('attachment-preview')
export let selectedFiles = []
export const attachmentPreviewMap = new Map()

export function initializeFileHandling() {
	const uploadButtonElement = document.getElementById('upload-button')
	uploadButtonElement.addEventListener('click', () => fileInputElement.click())
	fileInputElement.addEventListener('change', handleFilesSelect)
}

export async function handleFilesSelect(event) {
	const files = event.target.files || event.dataTransfer.files
	if (!files) return

	for (const file of files) {
		const reader = new FileReader()
		reader.onload = async (e) => {
			const newFile = {
				name: file.name,
				mimeType: file.type,
				buffer: arrayBufferToBase64(e.target.result),
				description: '',
			}
			selectedFiles.push(newFile)
			attachmentPreviewContainer.appendChild(
				await renderAttachmentPreview(
					newFile,
					selectedFiles.length - 1,
					attachmentPreviewContainer
				)
			)
		}
		reader.readAsArrayBuffer(file)
	}
	if (event.target === fileInputElement) fileInputElement.value = ''
}

export async function renderAttachmentPreview(file, index, container) {
	const isMessageArea =
		!container.classList.contains('attachment-preview') &&
		!container.classList.contains('attachment-edit-preview')

	const attachmentElement = document.createElement('div')
	attachmentElement.innerHTML = await renderTemplate('attachment_preview', {
		file,
		index,
		safeName: processTimeStampForId(file.name),
		showDownloadButton: isMessageArea,
		showDeleteButton: !isMessageArea,
	})

	const previewContainer = attachmentElement.querySelector('.preview-container')
	if (file.mimeType.startsWith('image/')) {
		const previewImg = document.createElement('img')
		previewImg.classList.add('preview-img')
		const base64Data = `data:${file.mimeType};base64,${file.buffer}`
		previewImg.src = base64Data
		previewImg.alt = file.name
		previewImg.addEventListener('click', () => {
			openModal(base64Data)
		})
		attachmentPreviewMap.set(previewImg, {
			name: file.name,
			mimeType: file.mimeType,
			buffer: file.buffer,
			description: file.description,
		})
		previewContainer.appendChild(previewImg)
	} else if (file.mimeType.startsWith('video/')) {
		const preview = document.createElement('video')
		preview.classList.add('preview')
		preview.src = `data:${file.mimeType};base64,${file.buffer}`
		preview.controls = true
		preview.muted = true
		previewContainer.appendChild(preview)
	} else {
		const preview = document.createElement('img')
		preview.classList.add('preview', 'file-icon')
		preview.src = 'https://api.iconify.design/line-md/file.svg'
		preview.alt = file.name
		previewContainer.appendChild(preview)
	}

	attachmentElement
		.querySelector('.download-button')
		?.addEventListener('click', () => downloadFile(file))
	attachmentElement
		.querySelector('.delete-button')
		?.addEventListener('click', () => {
			selectedFiles.splice(index, 1)
			attachmentElement.remove()
			// 从映射中删除
			const previewImg = attachmentElement.querySelector('.preview-img')
			if (previewImg) attachmentPreviewMap.delete(previewImg)
		})

	return attachmentElement
}

export function downloadFile(file) {
	const link = document.createElement('a')
	link.href = `data:${file.mimeType};base64,${file.buffer}`
	link.download = file.name
	link.click()
}

export function clearSelectedFiles() {
	selectedFiles = []
}
