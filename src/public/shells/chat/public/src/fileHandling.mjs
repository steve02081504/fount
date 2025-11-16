import { svgInliner } from '../../../../../scripts/svgInliner.mjs'
import { renderTemplate } from '../../../../../scripts/template.mjs'

import { getfile } from './files.mjs'
import { openModal } from './ui/modal.mjs'
import { processTimeStampForId, arrayBufferToBase64 } from './utils.mjs'

/**
 * 处理文件选择。
 * @param {Event} event - 事件。
 * @param {Array<object>} selectedFiles - 已选择的文件。
 * @param {HTMLElement} attachmentPreviewContainer - 附件预览容器。
 * @returns {Promise<void>}
 */
export async function handleFilesSelect(event, selectedFiles, attachmentPreviewContainer) {
	const files = event.target.files || event.dataTransfer.files
	if (!files) return

	for (const file of files) {
		const reader = new FileReader()
		/**
		 * 文件读取完成后的回调。
		 * @param {ProgressEvent<FileReader>} e - 事件。
		 */
		reader.onload = async e => {
			const newFile = {
				name: file.name,
				mime_type: file.type,
				buffer: arrayBufferToBase64(e.target.result),
				description: '',
			}
			selectedFiles.push(newFile)
			const attachmentElement = await renderAttachmentPreview(
				newFile,
				selectedFiles.length - 1,
				selectedFiles
			)
			if (attachmentElement) {
				attachmentElement.classList.add('attachment-entering')
				attachmentPreviewContainer.appendChild(attachmentElement)
				requestAnimationFrame(() => {
					attachmentElement.classList.remove('attachment-entering')
				})
			}
		}
		reader.readAsArrayBuffer(file)
	}
}

/**
 * 处理粘贴事件，将剪贴板中的图片添加到附件列表。
 *
 * @param {ClipboardEvent} event - 粘贴事件对象。
 * @param {Array} selectedFiles - 已选择的文件数组，用于存储新添加的文件。
 * @param {HTMLElement} attachmentPreviewContainer - 附件预览区域的 DOM 元素，用于显示新添加的附件。
 */
export async function handlePaste(event, selectedFiles, attachmentPreviewContainer) {
	const { items } = event.clipboardData || window.clipboardData
	for (const item of items)
		if (!item.type.indexOf('image')) {
			const blob = item.getAsFile()
			if (blob) {
				// 为 blob 创建一个唯一的文件名，例如使用时间戳和随机数
				const fileName = `pasted-image-${Date.now()}-${Math.floor(Math.random() * 1000)}.png`

				// 将 Blob 转换为 File 对象
				const file = new File([blob], fileName, { type: blob.type })

				// 创建一个假的 event 对象，模拟 file input 的 change 事件
				const fakeEvent = {
					target: {
						files: [file],
					},
				}
				// 使用 handleFilesSelect 函数处理图片文件
				await handleFilesSelect(fakeEvent, selectedFiles, attachmentPreviewContainer)
			}
		}
}

const PREVIEWABLE_MIME_TYPES = ['image/', 'video/', 'audio/']

/**
 * 渲染附件预览。
 * @param {object} file - 文件。
 * @param {number} index - 索引。
 * @param {Array<object>} selectedFiles - 已选择的文件。
 * @returns {Promise<HTMLElement>} - 附件元素。
 */
export async function renderAttachmentPreview(file, index, selectedFiles) {
	let attachmentElement = await renderTemplate('attachment_preview', {
		file,
		index,
		safeName: processTimeStampForId(file.name),
		showDownloadButton: !selectedFiles,
		showDeleteButton: selectedFiles,
	})

	const isPreviewable = PREVIEWABLE_MIME_TYPES.some(type => file.mime_type.startsWith(type))

	if (file.buffer.startsWith('file:') && isPreviewable) {
		file = { ...file }
		file.buffer = arrayBufferToBase64(await getfile(file.buffer))
	}

	const previewContainer = attachmentElement.querySelector('.preview-container')
	if (file.mime_type.startsWith('image/')) {
		const previewImg = document.createElement('img')
		previewImg.classList.add('preview-img')
		const base64Data = `data:${file.mime_type};base64,${file.buffer}`
		previewImg.src = base64Data
		previewImg.alt = file.name
		previewImg.addEventListener('click', () => {
			openModal(base64Data, 'image')
		})
		previewContainer.appendChild(previewImg)
	}
	else if (file.mime_type.startsWith('video/')) {
		const preview = document.createElement('video')
		preview.classList.add('preview')
		const videoSrc = `data:${file.mime_type};base64,${file.buffer}`
		preview.src = videoSrc
		preview.controls = true
		preview.autoplay = false

		preview.addEventListener('click', () => {
			openModal(videoSrc, 'video')
		})
		previewContainer.appendChild(preview)
	}
	else if (file.mime_type.startsWith('audio/')) {
		const audio = document.createElement('audio')
		audio.src = `data:${file.mime_type};base64,${file.buffer}`
		audio.controls = true
		previewContainer.appendChild(audio)
	}
	else {
		const preview = document.createElement('img')
		preview.classList.add('preview', 'icon')
		preview.src = 'https://api.iconify.design/line-md/file.svg'
		preview.alt = file.name
		preview.width = preview.height = 40
		previewContainer.appendChild(preview)
	}
	attachmentElement = await svgInliner(attachmentElement)

	attachmentElement
		.querySelector('.download-button')
		?.addEventListener('click', () => downloadFile(file))
	attachmentElement
		.querySelector('.delete-button')
		?.addEventListener('click', () => {
			const itemIndex = selectedFiles.indexOf(file)
			if (itemIndex > -1)
				selectedFiles.splice(itemIndex, 1)

			attachmentElement.classList.add('attachment-removing')

			/**
			 * 移除元素的回退函数。
			 */
			const removeWithFallback = () => {
				if (attachmentElement.parentNode)
					attachmentElement.remove()
			}

			attachmentElement.addEventListener('transitionend', removeWithFallback, { once: true })
		})

	return attachmentElement
}

/**
 * 下载文件。
 * @param {object} file - 文件。
 */
export function downloadFile(file) {
	const link = document.createElement('a')
	if (file.buffer.startsWith('file:'))
		link.href = `/api/shells/chat/getfile?hash=${file.buffer.slice(5)}`
	else
		link.href = `data:${file.mime_type};base64,${file.buffer}`

	link.download = file.name
	link.click()
}
