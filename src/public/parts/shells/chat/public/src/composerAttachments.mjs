/**
 * 【文件】public/src/composerAttachments.mjs
 * 【职责】编写器附件：选文件、粘贴、预览与上传前 base64 缩略。图片附件支持 alt 文本输入与图片编辑器。
 * 【原理】handleFilesSelect/handlePaste 维护 selectedFiles 数组；renderAttachmentPreview 用模板；getFile 预览已上传 hash。
 * 【数据结构】selectedFiles(File[])、attachmentPreviewContainer DOM。
 * 【关联】files.mjs、ui/modal.mjs、dragAndDrop.mjs；Hub composer。
 */
import { svgInliner } from '/scripts/lib/svgInliner.mjs'
import { renderTemplate } from '/scripts/features/template.mjs'
import { entityFileUrl, fetchEvfsFile } from '/parts/shells:chat/shared/evfsMedia.mjs'
import { parseEvfsRef } from './lib/evfsRef.mjs'
import { arrayBufferToBase64 } from './lib/federationUpload.mjs'
import { processTimeStampForId } from './lib/timestampId.mjs'
import { openModal } from './ui/modal.mjs'

/**
 * 将 base64 字符串转为 Blob。
 * @param {string} base64 base64 数据（不含 data URI 前缀）
 * @param {string} mimeType MIME 类型
 * @returns {Blob} 对应的 Blob 对象
 */
function base64ToBlob(base64, mimeType) {
	const binary = atob(base64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return new Blob([bytes], { type: mimeType })
}

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
		 * @param {ProgressEvent<FileReader>} e 读取完成事件
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
		if (item.type.startsWith('image/')) {
			const blob = item.getAsFile()
			if (blob)
				await handleFilesSelect(
					{ target: { files: [new File([blob], `pasted-image-${Date.now()}-${Math.floor(Math.random() * 1000)}.png`, { type: blob.type })] } },
					selectedFiles,
					attachmentPreviewContainer
				)
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
		showDeleteButton: !!selectedFiles,
	})

	const isPreviewable = PREVIEWABLE_MIME_TYPES.some(type => file.mime_type.startsWith(type))

	const evfsRef = typeof file.buffer === 'string' ? parseEvfsRef(file.buffer) : null
	if (evfsRef && isPreviewable) {
		file = { ...file }
		file.buffer = arrayBufferToBase64(await fetchEvfsFile(evfsRef.entityHash, evfsRef.logicalPath))
	}

	const previewContainer = attachmentElement.querySelector('.preview-container')
	if (file.mime_type.startsWith('image/')) {
		const base64Data = `data:${file.mime_type};base64,${file.buffer}`
		const previewImg = await renderTemplate('hub/composer/preview_img', {
			src: base64Data,
			alt: file.name,
		})
		previewImg.addEventListener('click', () => {
			openModal(base64Data, 'image')
		})
		previewContainer.appendChild(previewImg)

		const altInput = document.createElement('input')
		altInput.type = 'text'
		altInput.className = 'input input-bordered input-xs w-full mt-1 attachment-alt-input'
		altInput.dataset.i18n = 'chat.hub.altImagePlaceholder'
		altInput.value = file.description || ''
		altInput.addEventListener('input', () => { file.description = altInput.value })
		attachmentElement.appendChild(altInput)

		const editButton = document.createElement('button')
		editButton.type = 'button'
		editButton.className = 'btn btn-ghost btn-xs attachment-edit-button mt-1'
		editButton.dataset.i18n = 'chat.hub.editImage'
		editButton.textContent = '✎'
		editButton.addEventListener('click', async () => {
			try {
				const { openImageEditor } = await import('/scripts/imageEditor/index.mjs')
				const blob = base64ToBlob(file.buffer, file.mime_type)
				const edited = await openImageEditor(new File([blob], file.name, { type: file.mime_type }))
				if (!edited) return
				file.buffer = arrayBufferToBase64(await edited.arrayBuffer())
				file.name = edited.name
				file.mime_type = edited.type || file.mime_type
				const img = previewContainer.querySelector('img')
				if (img) img.src = `data:${file.mime_type};base64,${file.buffer}`
			}
			catch (err) { console.error('image edit failed:', err) }
		})
		attachmentElement.appendChild(editButton)
	}
	else if (file.mime_type.startsWith('video/')) {
		const videoSrc = `data:${file.mime_type};base64,${file.buffer}`
		const preview = await renderTemplate('hub/composer/preview_video', { src: videoSrc })
		preview.addEventListener('click', () => {
			openModal(videoSrc, 'video')
		})
		previewContainer.appendChild(preview)
	}
	else if (file.mime_type.startsWith('audio/')) {
		const audio = await renderTemplate('hub/composer/preview_audio', {
			src: `data:${file.mime_type};base64,${file.buffer}`,
		})
		previewContainer.appendChild(audio)
	}
	else {
		const preview = await renderTemplate('hub/composer/preview_file_icon', {
			alt: file.name,
		})
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
			attachmentElement.addEventListener('transitionend', () => {
				if (attachmentElement.parentNode)
					attachmentElement.remove()
			}, { once: true })
		})

	return attachmentElement
}

/**
 * 下载附件（EVFS ref / base64 字符串 / 原始 buffer）。
 * @param {object} file 文件描述
 */
export function downloadFile(file) {
	const link = document.createElement('a')
	if (file.url) link.href = file.url
	else if (typeof file.buffer === 'string') {
		const parsed = parseEvfsRef(file.buffer)
		link.href = parsed
			? entityFileUrl(parsed.entityHash, parsed.logicalPath)
			: `data:${file.mime_type};base64,${file.buffer}`
	}
	else
		link.href = `data:${file.mime_type};base64,${arrayBufferToBase64(file.buffer)}`

	link.download = file.name
	link.click()
}
