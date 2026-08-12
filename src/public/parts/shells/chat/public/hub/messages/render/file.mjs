/**
 * 【文件】public/hub/messages/render/file.mjs
 * 【职责】`content.files` 附件区渲染（画廊 / 音视频 / 文件卡）与懒加载媒体占位点击。
 */
import { createDocumentFragmentFromHtmlStringNoScriptActivation } from '../../../../../../scripts/features/template.mjs'
import { onElementRemoved } from '../../../../../../scripts/lib/onElementRemoved.mjs'
import { formatBytes } from '/scripts/lib/formatBytes.mjs'
import { fetchGroupFileAsBlobUrl } from '../../../src/groupFileBlob.mjs'
import { renderTemplateAsHtmlString } from '../../../src/templates.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { hasSpeechRecognitionSource } from '/scripts/features/speechRecognition.mjs'
import { getCachedSpeechRecognitionTranscript } from '/scripts/features/speechRecognitionCache.mjs'
import { openMediaViewer } from '/scripts/components/mediaViewer.mjs'
import { store } from '../../core/state.mjs'

const LAZY_MEDIA_BYTES = 2 * 1024 * 1024
const GALLERY_MAX_VISIBLE = 4

/** @type {boolean | null} */
let speechRecognitionMenuReady = null

/**
 * @param {string} groupId 群 ID
 * @param {string} fileId 文件 ID
 * @returns {string} 缓存键（群 ID + 文件 ID 复合，避免跨群同 ID 冲突）
 */
export function speechRecognitionCacheKey(groupId, fileId) {
	return `${groupId}:${fileId}`
}

/**
 * 若已配置语音识别，显示消息内音频菜单的识别项，并回填本地缓存转写。
 * @param {ParentNode} root 根
 * @returns {Promise<void>}
 */
export async function revealMessageAudioSpeechRecognitionItems(root) {
	speechRecognitionMenuReady ??= await hasSpeechRecognitionSource()
	if (!speechRecognitionMenuReady) return
	for (const item of root.querySelectorAll('.message-audio-speech-recognition-item'))
		item.classList.remove('hidden')
	for (const block of root.querySelectorAll('.message-inline-audio[data-group-file-id]')) {
		const fileId = block.getAttribute('data-group-file-id')
		const caption = block.querySelector('.attachment-transcript')
		if (!(caption instanceof HTMLElement) || caption.textContent?.trim()) continue
		const cached = getCachedSpeechRecognitionTranscript(speechRecognitionCacheKey(store.context.currentGroupId, fileId))
		if (!cached) continue
		caption.textContent = cached
		caption.classList.remove('hidden')
	}
}

/** @type {Map<string, string>} blobUrl → `${groupId}:${channelId}` */
const trackedBlobUrls = new Map()

/**
 * @returns {string | null} 当前群+频道键；缺任一侧则为 null
 */
function currentChannelBlobKey() {
	const groupId = store.context.currentGroupId
	const channelId = store.context.currentChannelId
	return groupId && channelId ? `${groupId}:${channelId}` : null
}

/**
 * @param {string} url Blob URL
 * @returns {void}
 */
function revokeTrackedBlobUrl(url) {
	if (!trackedBlobUrls.delete(url)) return
	URL.revokeObjectURL(url)
}

/**
 * 将 `blob:` src 的生命周期绑到媒体节点移除。
 * @param {ParentNode} root 扫描根
 * @returns {void}
 */
function bindBlobUrlCleanup(root) {
	if (!root?.querySelectorAll) return
	for (const el of root.querySelectorAll('[src^="blob:"]')) {
		if (el.dataset.blobUrlTracked === '1') continue
		const url = el.getAttribute('src')
		if (!url || !trackedBlobUrls.has(url)) continue
		el.dataset.blobUrlTracked = '1'
		onElementRemoved(el, () => revokeTrackedBlobUrl(url))
	}
}

/**
 * 释放指定频道虚列表相关的群文件 Blob URL（其它频道的 URL 保留）。
 * @param {string | null | undefined} channelKey `${groupId}:${channelId}`；缺省则无操作
 * @returns {void}
 */
export function revokeGroupFileBlobUrlsForChannel(channelKey) {
	if (!channelKey) return
	for (const [url, key] of trackedBlobUrls) {
		if (key !== channelKey) continue
		trackedBlobUrls.delete(url)
		URL.revokeObjectURL(url)
	}
}

/**
 * @param {string} groupId 群 ID
 * @param {string} fileId 文件 ID
 * @returns {Promise<string | null>} Blob URL；失败已 toast 时为 null
 */
async function loadGroupFileBlobUrl(groupId, fileId) {
	const ownerKey = currentChannelBlobKey()
	try {
		const url = await fetchGroupFileAsBlobUrl(groupId, fileId)
		const liveKey = store.messages.channelPipelineKey || currentChannelBlobKey()
		if (!ownerKey || liveKey !== ownerKey) {
			URL.revokeObjectURL(url)
			return null
		}
		trackedBlobUrls.set(url, ownerKey)
		return url
	}
	catch (error) {
		handleError('chat.hub.file.loadFailed')(error)
		return null
	}
}

/** 同一微任务队列内是否已调度过音频识别菜单揭示，避免批量渲染时重复扫描 `#messages`。 */
let revealScheduled = false

/**
 * 合并调度 `revealMessageAudioSpeechRecognitionItems(#messages)`：同一微任务队列内只执行一次。
 * @returns {void}
 */
export function scheduleRevealMessageAudioSpeechRecognitionItems() {
	if (revealScheduled) return
	revealScheduled = true
	queueMicrotask(() => {
		revealScheduled = false
		const host = document.getElementById('messages')
		if (host) void revealMessageAudioSpeechRecognitionItems(host)
	})
}

/**
 * @param {string} mime MIME
 * @returns {'image' | 'video' | 'audio' | 'file'} 类别
 */
function fileKind(mime) {
	if (mime.startsWith('image/')) return 'image'
	if (mime.startsWith('video/')) return 'video'
	if (mime.startsWith('audio/')) return 'audio'
	return 'file'
}

/**
 * @param {{ mime_type?: string, buffer?: string, fileId?: string }} file 描述符
 * @returns {string | null} data URL 或 null
 */
function localDataUrl(file) {
	const buf = file.buffer
	if (typeof buf !== 'string' || !buf) return null
	if (buf.startsWith('data:')) return buf
	const mime = String(file.mime_type || 'application/octet-stream')
	return `data:${mime};base64,${buf}`
}

/**
 * @param {string} groupId 群 ID
 * @param {object} file 文件描述符
 * @param {string} mime MIME
 * @param {{ gallery?: boolean, pending?: boolean }} [opts] 选项
 * @returns {Promise<string>} 单附件 HTML
 */
async function renderImageOrVideoHtml(groupId, file, mime, { gallery = false, pending = false } = {}) {
	const id = file.fileId || ''
	const fileName = escapeHtml(file.name || id || 'file')
	const alt = escapeHtml(file.description || '')
	const local = localDataUrl(file)
	const size = Number(file.size) || 0
	if (size > LAZY_MEDIA_BYTES && id && !local)
		return renderTemplateAsHtmlString('hub/messages/media_placeholder', {
			fileId: escapeHtml(id),
			fileName,
			mimeType: escapeHtml(mime),
		})

	let src = local
	if (!src && id) src = await loadGroupFileBlobUrl(groupId, id)
	if (!src)
		return '<div class="text-xs text-error opacity-80 mt-1 media-error" data-i18n="chat.hub.attachmentLoadFailed"></div>'

	if (mime.startsWith('image/'))
		return renderTemplateAsHtmlString('hub/messages/inline_image', {
			fileName,
			src: escapeHtml(src),
			alt,
			gallery: gallery ? '1' : '',
			pending: pending || (!id && local) ? '1' : '',
		})

	return renderTemplateAsHtmlString('hub/messages/inline_video', {
		src: escapeHtml(src),
		gallery: gallery ? '1' : '',
		fileName,
	})
}

/**
 * @param {string} groupId 群 ID
 * @param {object} file 描述符
 * @param {string} mime MIME
 * @returns {Promise<string>} HTML
 */
async function renderAudioHtml(groupId, file, mime) {
	const id = file.fileId || ''
	const fileName = escapeHtml(file.name || id || 'audio')
	const size = Number(file.size) || 0
	const local = localDataUrl(file)
	if (size > LAZY_MEDIA_BYTES && id && !local)
		return renderTemplateAsHtmlString('hub/messages/media_placeholder', {
			fileId: escapeHtml(id),
			fileName,
			mimeType: escapeHtml(mime),
		})
	const blobUrl = local || (id ? await loadGroupFileBlobUrl(groupId, id) : null)
	if (!blobUrl)
		return '<div class="text-xs text-error opacity-80 mt-1 media-error" data-i18n="chat.hub.attachmentLoadFailed"></div>'
	const transcript = escapeHtml(file.description || '')
	return renderTemplateAsHtmlString('hub/messages/inline_audio', {
		src: escapeHtml(blobUrl),
		fileId: escapeHtml(id),
		fileName,
		transcript,
		hasTranscript: transcript ? '1' : '',
	})
}

/**
 * @param {object} file 描述符
 * @returns {Promise<string>} HTML
 */
async function renderFileCardHtml(file) {
	const id = file.fileId || ''
	const fileName = escapeHtml(file.name || id || 'file')
	const sizeLabel = formatBytes(Number(file.size) || 0)
	return `<button type="button" class="message-file-card message-file-download" data-group-file-id="${escapeHtml(id)}">
		<span class="message-file-card-icon" aria-hidden="true">📄</span>
		<span class="message-file-card-meta">
			<span class="message-file-card-name truncate">${fileName}</span>
			<span class="message-file-card-size">${escapeHtml(sizeLabel)}</span>
		</span>
	</button>`
}

/**
 * 渲染 `content.files` 附件区（图/音视频/懒加载/下载）。
 * @param {object} message 消息行
 * @returns {Promise<string>} HTML 片段
 */
export async function renderMessageFileIdsHtml(message) {
	const files = message.content?.files
	const groupId = store.context.currentGroupId
	if (!Array.isArray(files) || !files.length) return ''

	/** @type {object[]} */
	const imagesAndVideos = []
	/** @type {object[]} */
	const audios = []
	/** @type {object[]} */
	const others = []

	for (const file of files) {
		const id = String(file?.fileId || '').trim()
		const hasLocal = typeof file?.buffer === 'string' && file.buffer.length > 0
		if (!id && !hasLocal) continue
		const mime = file.mime_type || ''
		const kind = fileKind(mime)
		if (kind === 'image' || kind === 'video') imagesAndVideos.push(file)
		else if (kind === 'audio') audios.push(file)
		else others.push(file)
	}

	const parts = []
	const pending = !!(message.pending || message.deliveryStatus === 'pending')

	if (imagesAndVideos.length === 1) {
		const file = imagesAndVideos[0]
		const mime = file.mime_type || ''
		parts.push(await renderImageOrVideoHtml(groupId, file, mime, {
			gallery: false,
			pending: pending || !file.fileId,
		}))
	}
	else if (imagesAndVideos.length > 1) {
		const visible = imagesAndVideos.slice(0, GALLERY_MAX_VISIBLE)
		const overflow = imagesAndVideos.length - visible.length
		const cells = []
		for (let visibleIndex = 0; visibleIndex < visible.length; visibleIndex++) {
			const file = visible[visibleIndex]
			const mime = file.mime_type || ''
			let cell = await renderImageOrVideoHtml(groupId, file, mime, {
				gallery: true,
				pending: pending || !file.fileId,
			})
			if (overflow > 0 && visibleIndex === visible.length - 1)
				cell = `<div class="message-gallery-overflow-wrap">${cell}<span class="message-gallery-overflow">+${overflow}</span></div>`
			cells.push(cell)
		}
		const countClass = imagesAndVideos.length === 2
			? 'message-gallery--2'
			: imagesAndVideos.length === 3
				? 'message-gallery--3'
				: 'message-gallery--4'
		parts.push(`<div class="message-gallery ${countClass}">${cells.join('')}</div>`)
	}

	for (const file of audios)
		parts.push(await renderAudioHtml(groupId, file, file.mime_type || ''))
	for (const file of others)
		parts.push(await renderFileCardHtml(file))

	if (!parts.length) return ''
	return `<div class="message-files">${parts.join('')}</div>`
}

/**
 * @param {HTMLElement} container 消息列表根
 * @returns {void}
 */
export function wireMessageMediaPlaceholders(container) {
	bindBlobUrlCleanup(container)
	if (container.dataset.mediaPlaceholdersWired === '1') return
	container.dataset.mediaPlaceholdersWired = '1'

	container.addEventListener('click', async event => {
		const mediaEl = event.target.closest('[data-media-viewer-src]')
		if (mediaEl && container.contains(mediaEl)) {
			event.preventDefault()
			event.stopPropagation()
			const row = mediaEl.closest('.message, .chat')
			const nodes = [...(row || container).querySelectorAll('[data-media-viewer-src]')]
			const items = nodes.map(node => ({
				src: node.getAttribute('data-media-viewer-src') || '',
				name: node.getAttribute('data-media-viewer-name') || '',
				mimeType: node.getAttribute('data-media-viewer-mime') || 'image/*',
			})).filter(item => item.src)
			const startIndex = Math.max(0, nodes.indexOf(mediaEl))
			openMediaViewer(items, startIndex)
			return
		}

		const placeholder = event.target.closest('[data-media-placeholder]')
		if (!placeholder || placeholder.dataset.mediaLoaded === '1') return
		const fileId = placeholder.getAttribute('data-group-file-id')
		const groupId = store.context.currentGroupId
		if (!fileId || !groupId) return
		event.preventDefault()
		event.stopPropagation()
		const mime = String(placeholder.getAttribute('data-mime') || '')
		const blobUrl = await loadGroupFileBlobUrl(groupId, fileId)
		if (!blobUrl) {
			const err = document.createElement('div')
			err.className = 'text-xs text-error opacity-80 mt-1 media-error'
			err.dataset.i18n = 'chat.hub.attachmentLoadFailed'
			placeholder.replaceWith(err)
			return
		}
		try {
			const src = escapeHtml(blobUrl)
			const fileName = escapeHtml(placeholder.querySelector('.truncate')?.textContent || fileId)
			const html = mime.startsWith('video/')
				? await renderTemplateAsHtmlString('hub/messages/inline_video', { src, fileName, gallery: '' })
				: mime.startsWith('audio/')
					? await renderTemplateAsHtmlString('hub/messages/inline_audio', {
						src,
						fileId: escapeHtml(fileId),
						fileName,
						transcript: '',
						hasTranscript: '',
					})
					: await renderTemplateAsHtmlString('hub/messages/inline_image', {
						fileName,
						src,
						alt: '',
						gallery: '',
						pending: '',
					})
			const frag = await createDocumentFragmentFromHtmlStringNoScriptActivation(html)
			const node = frag.firstElementChild
			if (!node) {
				revokeTrackedBlobUrl(blobUrl)
				return
			}
			placeholder.replaceWith(node)
			bindBlobUrlCleanup(node.parentElement)
			if (mime.startsWith('audio/')) void revealMessageAudioSpeechRecognitionItems(node)
		}
		catch (error) {
			revokeTrackedBlobUrl(blobUrl)
			handleError('chat.hub.file.loadFailed')(error)
		}
	})
}
