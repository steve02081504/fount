/**
 * 【文件】public/src/composerAttachments.mjs
 * 【职责】编写器附件：选文件、粘贴、预览与上传前 base64 缩略。图片附件支持 alt 文本输入与图片编辑器。
 * 【原理】handleFilesSelect/handlePaste 维护 selectedFiles 数组；renderAttachmentPreview 用模板；getFile 预览已上传 hash。
 * 【数据结构】selectedFiles(File[])、attachmentPreviewContainer DOM。
 * 【关联】files.mjs、dragAndDrop.mjs、mediaViewer；Hub composer。
 */
import { svgInliner } from '/scripts/lib/svgInliner.mjs'
import { renderTemplate } from '/scripts/features/template.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { hasSpeechRecognitionSource, recognizeBuffer } from '/scripts/features/speechRecognition.mjs'
import { setCachedSpeechRecognitionTranscript } from '/scripts/features/speechRecognitionCache.mjs'
import { entityFileUrl, fetchEvfsFile } from '/scripts/endpoints/p2p/evfsMedia.mjs'
import { onElementRemoved } from '/scripts/lib/onElementRemoved.mjs'
import { parseEvfsRef } from './lib/evfsRef.mjs'
import { arrayBufferToBase64 } from './lib/federationUpload.mjs'
import { processTimeStampForId } from './lib/timestampId.mjs'
import { openMediaViewer } from '/scripts/components/mediaViewer.mjs'

/** @type {boolean | null} */
let speechRecognitionConfiguredCache = null

/**
 * @returns {Promise<boolean>} 是否配置语音识别
 */
async function speechRecognitionConfigured() {
	if (speechRecognitionConfiguredCache != null) return speechRecognitionConfiguredCache
	speechRecognitionConfiguredCache = await hasSpeechRecognitionSource()
	return speechRecognitionConfiguredCache
}

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
 * 本地 base64 / data URI → object URL，并在节点移除时 revoke。
 * @param {string} localBuffer base64 或 data URI
 * @param {string} mime MIME
 * @param {HTMLElement} owner 绑定生命周期的预览节点
 * @returns {string} object URL
 */
function objectUrlFromLocalBuffer(localBuffer, mime, owner) {
	const url = URL.createObjectURL(base64ToBlob(
		localBuffer.replace(/^data:[^;]+;base64,/, ''),
		mime,
	))
	onElementRemoved(owner, () => URL.revokeObjectURL(url))
	return url
}

/**
 * 带动画移除附件预览节点；无 transition 时超时兜底。
 * @param {HTMLElement} attachmentElement 附件元素
 * @returns {void}
 */
function removeAttachmentElement(attachmentElement) {
	attachmentElement.classList.add('attachment-removing')
	let removed = false
	/**
	 * @returns {void}
	 */
	const remove = () => {
		if (removed) return
		removed = true
		attachmentElement.remove()
	}
	attachmentElement.addEventListener('transitionend', remove, { once: true })
	setTimeout(remove, 400)
}

/**
 * 处理文件选择。按原始文件顺序依次读取与渲染，避免异步完成顺序打乱附件顺序。
 * @param {Event} event - 事件。
 * @param {Array<object>} selectedFiles - 已选择的文件。
 * @param {HTMLElement} attachmentPreviewContainer - 附件预览容器。
 * @param {{ groupId?: string | null, onFilesChange?: (count: number) => void }} [options] 群 ID 与附件数变化回调
 * @returns {Promise<{ file: object, element: HTMLElement }[]>} 新增附件及其预览元素
 */
export async function handleFilesSelect(event, selectedFiles, attachmentPreviewContainer, {
	groupId = null,
	onFilesChange = null,
} = {}) {
	const files = event.target.files || event.dataTransfer.files
	if (!files) return []

	/** @type {{ file: object, element: HTMLElement }[]} */
	const added = []
	for (const file of files) {
		const newFile = {
			name: file.name,
			mime_type: file.type,
			size: file.size,
			buffer: arrayBufferToBase64(await file.arrayBuffer()),
			description: '',
		}
		selectedFiles.push(newFile)
		const attachmentElement = await renderAttachmentPreview(
			newFile,
			selectedFiles.length - 1,
			selectedFiles,
			{ groupId, onFilesChange },
		)
		added.push({ file: newFile, element: attachmentElement })
		if (attachmentElement) {
			attachmentElement.classList.add('attachment-entering')
			attachmentPreviewContainer.appendChild(attachmentElement)
			requestAnimationFrame(() => {
				attachmentElement.classList.remove('attachment-entering')
			})
		}
	}
	onFilesChange?.(selectedFiles.length)
	return added
}

/**
 * 处理粘贴事件，将剪贴板中的图片添加到附件列表。
 *
 * @param {ClipboardEvent} event - 粘贴事件对象。
 * @param {Array} selectedFiles - 已选择的文件数组，用于存储新添加的文件。
 * @param {HTMLElement} attachmentPreviewContainer - 附件预览区域的 DOM 元素，用于显示新添加的附件。
 * @param {{ groupId?: string | null, onFilesChange?: (count: number) => void }} [options] 群 ID 与附件数变化回调
 */
export async function handlePaste(event, selectedFiles, attachmentPreviewContainer, options = {}) {
	const { items } = event.clipboardData || window.clipboardData
	/** @type {File[]} */
	const files = []
	for (const item of items) {
		const blob = item.getAsFile?.()
		if (!blob) continue
		const type = item.type || blob.type || 'application/octet-stream'
		const ext = type.includes('/') ? type.split('/')[1].split(';')[0] : 'bin'
		const name = blob.name && blob.name !== 'image.png'
			? blob.name
			: `pasted-${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext === 'plain' ? 'txt' : ext}`
		files.push(new File([blob], name, { type }))
	}
	if (!files.length) return
	event.preventDefault?.()
	await handleFilesSelect(
		{ target: { files } },
		selectedFiles,
		attachmentPreviewContainer,
		options,
	)
}

const PREVIEWABLE_MIME_TYPES = ['image/', 'video/', 'audio/']

/**
 * 追加通用文件图标预览。
 * @param {HTMLElement} previewContainer 预览容器
 * @param {object} file 文件描述
 * @returns {Promise<void>}
 */
async function appendFileIconPreview(previewContainer, file) {
	const preview = await renderTemplate('hub/composer/preview_file_icon', { alt: file.name })
	previewContainer.appendChild(preview)
}

/**
 * 本地图片预览：缩略图与编写态 alt 输入。
 * @param {HTMLElement} attachmentElement 附件根节点
 * @param {object} file 文件描述
 * @param {string} mime MIME
 * @param {boolean} composing 是否编写态
 * @param {HTMLElement} previewContainer 预览容器
 * @param {string} localBuffer 本地 base64 缓冲
 * @returns {Promise<void>}
 */
async function appendLocalImagePreview(attachmentElement, file, mime, composing, previewContainer, localBuffer) {
	const previewUrl = objectUrlFromLocalBuffer(localBuffer, mime || 'image/*', attachmentElement)
	const previewImg = await renderTemplate('hub/composer/preview_img', {
		src: previewUrl,
		alt: file.name,
	})
	previewImg.addEventListener('click', () => {
		openMediaViewer([{ src: previewImg.src, name: file.name, mimeType: mime }], 0)
	})
	previewContainer.appendChild(previewImg)

	if (composing) {
		const altInput = document.createElement('input')
		altInput.type = 'text'
		altInput.className = 'input input-bordered input-xs attachment-alt-input'
		altInput.dataset.i18n = 'chat.hub.altImage'
		altInput.value = file.description || ''
		altInput.addEventListener('input', () => { file.description = altInput.value })
		attachmentElement.querySelector('.file-name')?.after(altInput)
	}
}

/**
 * 本地视频预览。
 * @param {HTMLElement} attachmentElement 附件根节点
 * @param {object} file 文件描述
 * @param {string} mime MIME
 * @param {HTMLElement} previewContainer 预览容器
 * @param {string} localBuffer 本地 base64 缓冲
 * @returns {Promise<void>}
 */
async function appendLocalVideoPreview(attachmentElement, file, mime, previewContainer, localBuffer) {
	const videoSrc = objectUrlFromLocalBuffer(localBuffer, mime || 'video/*', attachmentElement)
	const preview = await renderTemplate('hub/composer/preview_video', { src: videoSrc })
	preview.addEventListener('click', () => {
		openMediaViewer([{ src: videoSrc, name: file.name, mimeType: mime }], 0)
	})
	previewContainer.appendChild(preview)
}

/**
 * 本地音频预览。
 * @param {HTMLElement} attachmentElement 附件根节点
 * @param {string} mime MIME
 * @param {HTMLElement} previewContainer 预览容器
 * @param {string} localBuffer 本地 base64 缓冲
 * @returns {Promise<void>}
 */
async function appendLocalAudioPreview(attachmentElement, mime, previewContainer, localBuffer) {
	const audioSrc = objectUrlFromLocalBuffer(localBuffer, mime || 'audio/*', attachmentElement)
	const audio = await renderTemplate('hub/composer/preview_audio', { src: audioSrc })
	previewContainer.appendChild(audio)
}

/**
 * 群文件图片预览：拉取 blob URL，失败时回退为文件图标。
 * @param {HTMLElement} previewContainer 预览容器
 * @param {object} file 文件描述
 * @param {string} mime MIME
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
async function appendGroupFileImagePreview(previewContainer, file, mime, groupId) {
	try {
		const { fetchGroupFileAsBlobUrl } = await import('./groupFileBlob.mjs')
		const url = await fetchGroupFileAsBlobUrl(groupId, file.fileId)
		const previewImg = await renderTemplate('hub/composer/preview_img', {
			src: url,
			alt: file.name,
		})
		onElementRemoved(previewImg, () => URL.revokeObjectURL(url))
		previewImg.addEventListener('click', () => {
			openMediaViewer([{ src: url, name: file.name, mimeType: mime }], 0)
		})
		previewContainer.appendChild(previewImg)
	}
	catch {
		await appendFileIconPreview(previewContainer, file)
	}
}

/**
 * 绑定图片编辑按钮：打开编辑器并刷新预览。
 * @param {HTMLElement} attachmentElement 附件根节点
 * @param {object} file 文件描述
 * @param {HTMLElement} previewContainer 预览容器
 */
function bindImageEditHandler(attachmentElement, file, previewContainer) {
	attachmentElement.querySelector('.attachment-edit-button')?.addEventListener('click', async () => {
		try {
			const { openImageEditor } = await import('/scripts/components/imageEditor.mjs')
			const blob = base64ToBlob(file.buffer.replace(/^data:[^;]+;base64,/, ''), file.mime_type)
			const edited = await openImageEditor(new File([blob], file.name, { type: file.mime_type }), {
				titleI18n: 'chat.hub.editImage',
			})
			if (!edited) return
			file.buffer = arrayBufferToBase64(await edited.arrayBuffer())
			file.name = edited.name
			file.mime_type = edited.type || file.mime_type
			file.size = edited.size
			const img = previewContainer.querySelector('img')
			if (img) {
				const nextUrl = objectUrlFromLocalBuffer(file.buffer, file.mime_type, attachmentElement)
				URL.revokeObjectURL(img.src)
				img.src = nextUrl
			}
			const nameEl = attachmentElement.querySelector('.file-name')
			if (nameEl) nameEl.textContent = file.name
		}
		catch (err) { console.error('image edit failed:', err) }
	})
}

/**
 * 绑定语音识别按钮：转写音频并展示字幕。
 * @param {HTMLElement} attachmentElement 附件根节点
 * @param {object} file 文件描述
 */
function bindSpeechRecognitionHandler(attachmentElement, file) {
	attachmentElement
		.querySelector('.speech-recognition-button')
		?.addEventListener('click', async () => {
			try {
				const bytes = typeof file.buffer === 'string'
					? Uint8Array.from(atob(file.buffer), c => c.charCodeAt(0))
					: new Uint8Array(file.buffer)
				const result = await recognizeBuffer({
					audio: bytes,
					mime_type: file.mime_type,
					name: file.name,
				})
				file.description = result.text
				setCachedSpeechRecognitionTranscript(file.contentHash || file.name, result.text)
				let caption = attachmentElement.querySelector('.attachment-transcript')
				if (!caption) {
					caption = document.createElement('p')
					caption.className = 'attachment-transcript text-xs opacity-70 mt-1'
					caption.setAttribute('user-content', '')
					attachmentElement.querySelector('.file-name')?.after(caption)
				}
				caption.textContent = result.text
			}
			catch (error) {
				showToastI18n('error', 'chat.voiceRecording.speechRecognitionFailed', { error: error?.message || String(error) })
			}
		})
}

/**
 * 绑定删除按钮：从列表移除并播放退出动画。
 * @param {HTMLElement} attachmentElement 附件根节点
 * @param {object} file 文件描述
 * @param {Array<object>} selectedFiles 已选文件列表
 * @param {(count: number) => void | null} onFilesChange 数量变化回调
 */
function bindDeleteHandler(attachmentElement, file, selectedFiles, onFilesChange) {
	attachmentElement
		.querySelector('.delete-button')
		?.addEventListener('click', () => {
			const itemIndex = selectedFiles.indexOf(file)
			if (itemIndex > -1)
				selectedFiles.splice(itemIndex, 1)

			removeAttachmentElement(attachmentElement)
			onFilesChange?.(selectedFiles.length)
		})
}

/**
 * 渲染附件预览。
 * @param {object} file - 文件。
 * @param {number} index - 索引。
 * @param {Array<object>} selectedFiles - 已选择的文件。
 * @param {{ groupId?: string | null, onFilesChange?: (count: number) => void }} [options] 群 ID 与附件数变化回调
 * @returns {Promise<HTMLElement>} - 附件元素。
 */
export async function renderAttachmentPreview(file, index, selectedFiles, {
	groupId = null,
	onFilesChange = null,
} = {}) {
	const mime = (file.mime_type || '')
	const isImage = mime.startsWith('image/')
	const isAudio = mime.startsWith('audio/')
	const isVideo = mime.startsWith('video/')
	const composing = !!selectedFiles
	const showSpeechRecognitionButton = isAudio && composing && await speechRecognitionConfigured()
	const showEditButton = isImage && composing && !!file.buffer
	let attachmentElement = await renderTemplate('attachment_preview', {
		file,
		index,
		safeName: processTimeStampForId(file.name),
		showDownloadButton: !composing,
		showDeleteButton: composing,
		showSpeechRecognitionButton,
		showEditButton,
		buttonGroupJoin: [!composing, showSpeechRecognitionButton, showEditButton, composing].filter(Boolean).length > 1,
	})

	const isPreviewable = PREVIEWABLE_MIME_TYPES.some(type => mime.startsWith(type))

	const evfsRef = typeof file.buffer === 'string' ? parseEvfsRef(file.buffer) : null
	if (evfsRef && isPreviewable) {
		file = { ...file }
		file.buffer = arrayBufferToBase64((await fetchEvfsFile(evfsRef.entityHash, evfsRef.logicalPath)).buffer)
	}

	const previewContainer = attachmentElement.querySelector('.preview-container')
	const localBuffer = typeof file.buffer === 'string' && file.buffer.length ? file.buffer : null
	if (isImage && localBuffer) {
		await appendLocalImagePreview(attachmentElement, file, mime, composing, previewContainer, localBuffer)
		bindImageEditHandler(attachmentElement, file, previewContainer)
	}
	else if (isImage && file.fileId && groupId)
		await appendGroupFileImagePreview(previewContainer, file, mime, groupId)
	else if (isVideo)
		if (localBuffer)
			await appendLocalVideoPreview(attachmentElement, file, mime, previewContainer, localBuffer)
		else
			await appendFileIconPreview(previewContainer, file)
	else if (isAudio && localBuffer)
		await appendLocalAudioPreview(attachmentElement, mime, previewContainer, localBuffer)
	else
		await appendFileIconPreview(previewContainer, file)

	attachmentElement = await svgInliner(attachmentElement)

	attachmentElement
		.querySelector('.download-button')
		?.addEventListener('click', () => downloadFile(file))
	bindSpeechRecognitionHandler(attachmentElement, file)
	bindDeleteHandler(attachmentElement, file, selectedFiles, onFilesChange)

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
