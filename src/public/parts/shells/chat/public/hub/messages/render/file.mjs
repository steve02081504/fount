/**
 * 【文件】public/hub/messages/render/file.mjs
 * 【职责】`content.files` 附件区渲染与懒加载媒体占位点击。
 */
import {
	createDocumentFragmentFromHtmlStringNoScriptActivation,
	renderTemplateAsHtmlString,
} from '../../../../../../scripts/features/template.mjs'
import { onElementRemoved } from '../../../../../../scripts/lib/onElementRemoved.mjs'
import { fetchGroupFileAsBlobUrl } from '../../../src/groupFileBlob.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { hasSpeechRecognitionSource } from '/scripts/features/speechRecognition.mjs'
import { getCachedSpeechRecognitionTranscript } from '/scripts/features/speechRecognitionCache.mjs'
import { store } from '../../core/state.mjs'

import { getMessageText } from './text.mjs'

const LAZY_MEDIA_BYTES = 2 * 1024 * 1024

/** @type {boolean | null} */
let speechRecognitionMenuReady = null

/**
 * 若已配置语音识别，显示消息内音频菜单的识别项，并回填本地缓存转写。
 * @param {ParentNode} root 根
 * @returns {Promise<void>}
 */
export async function revealMessageAudioSpeechRecognitionItems(root) {
	if (!root?.querySelectorAll) return
	speechRecognitionMenuReady ??= await hasSpeechRecognitionSource()
	if (!speechRecognitionMenuReady) return
	for (const item of root.querySelectorAll('.message-audio-speech-recognition-item'))
		item.classList.remove('hidden')
	for (const block of root.querySelectorAll('.message-inline-audio[data-group-file-id]')) {
		const fileId = block.getAttribute('data-group-file-id')
		const caption = block.querySelector('.attachment-transcript')
		if (!(caption instanceof HTMLElement) || caption.textContent?.trim()) continue
		const cached = getCachedSpeechRecognitionTranscript(fileId)
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

/**
 * @param {string} groupId 群 ID
 * @param {string} id 文件 ID
 * @param {object} meta 文件元数据
 * @param {string} mime MIME
 * @param {string} [alt] 图片 alt 文本
 * @returns {Promise<string>} 单附件 HTML
 */
async function renderSingleFileAttachmentHtml(groupId, id, meta, mime, alt) {
	const fileName = escapeHtml(meta.name || id)
	if (mime.startsWith('image/')) {
		const blobUrl = await loadGroupFileBlobUrl(groupId, id)
		if (!blobUrl)
			return renderTemplateAsHtmlString('hub/messages/media_error', {})
		return renderTemplateAsHtmlString('hub/messages/inline_image', {
			fileName,
			src: escapeHtml(blobUrl),
			alt: escapeHtml(alt || meta.description || ''),
		})
	}
	const size = Number(meta.size) || 0
	const lazy = size > LAZY_MEDIA_BYTES
	if (mime.startsWith('video/') || mime.startsWith('audio/')) {
		if (lazy)
			return renderTemplateAsHtmlString('hub/messages/media_placeholder', {
				fileId: escapeHtml(id),
				fileName,
				mimeType: escapeHtml(mime),
			})
		const blobUrl = await loadGroupFileBlobUrl(groupId, id)
		if (!blobUrl)
			return renderTemplateAsHtmlString('hub/messages/media_error', {})
		if (mime.startsWith('video/'))
			return renderTemplateAsHtmlString('hub/messages/inline_video', { src: escapeHtml(blobUrl) })
		const transcript = escapeHtml(meta.description || '')
		return renderTemplateAsHtmlString('hub/messages/inline_audio', {
			src: escapeHtml(blobUrl),
			fileId: escapeHtml(id),
			fileName,
			transcript,
			hasTranscript: transcript ? '1' : '',
		})
	}
	if (lazy)
		return renderTemplateAsHtmlString('hub/messages/media_placeholder', {
			fileId: escapeHtml(id),
			fileName,
			mimeType: escapeHtml(mime || 'application/octet-stream'),
		})
	return `<button type="button" class="btn btn-xs btn-ghost message-file-download" data-group-file-id="${escapeHtml(id)}">${fileName}</button>`
}

/**
 * 渲染 `content.files` 附件区（图/音视频/懒加载/下载）。
 * @param {object} message 消息行
 * @returns {Promise<string>} HTML 片段
 */
export async function renderMessageFileIdsHtml(message) {
	const files = message.content?.files
	const groupId = store.context.currentGroupId
	if (!groupId || !Array.isArray(files) || !files.length) return ''

	const text = getMessageText(message)
	const rows = []
	for (const file of files) {
		const id = String(file?.fileId || '').trim()
		if (!id) continue
		const meta = {
			name: file.name || id,
			size: Number(file.size) || 0,
			description: file.description || '',
		}
		const mime = String(file.mime_type || '')
		if (mime.startsWith('image/') && text.includes('[image:')) continue
		const alt = file.description || ''
		rows.push(await renderSingleFileAttachmentHtml(groupId, id, meta, mime, alt))
	}
	if (!rows.length) return ''
	const html = `<div class="message-files flex flex-col gap-1 mt-1">${rows.join('')}</div>`
	queueMicrotask(() => {
		const host = document.getElementById('messages')
		if (host) void revealMessageAudioSpeechRecognitionItems(host)
	})
	return html
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
			placeholder.replaceWith(
				await createDocumentFragmentFromHtmlStringNoScriptActivation(
					await renderTemplateAsHtmlString('hub/messages/media_error', {}),
				).firstElementChild || document.createElement('div'),
			)
			return
		}
		try {
			const src = escapeHtml(blobUrl)
			const html = mime.startsWith('video/')
				? await renderTemplateAsHtmlString('hub/messages/inline_video', { src })
				: mime.startsWith('audio/')
					? await renderTemplateAsHtmlString('hub/messages/inline_audio', {
						src,
						fileId: escapeHtml(fileId),
						fileName: escapeHtml(placeholder.querySelector('.truncate')?.textContent || fileId),
						transcript: '',
						hasTranscript: '',
					})
					: await renderTemplateAsHtmlString('hub/messages/inline_image', {
						fileName: escapeHtml(placeholder.querySelector('.truncate')?.textContent || fileId),
						src,
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
