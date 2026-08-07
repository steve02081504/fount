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
import { store } from '../../core/state.mjs'

import { getMessageText } from './text.mjs'

const LAZY_MEDIA_BYTES = 2 * 1024 * 1024

/** @type {Set<string>} */
const trackedBlobUrls = new Set()

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
 * 释放尚未/已无法绑定到 DOM 的全部群文件 Blob URL（频道虚列表销毁时调用）。
 * @returns {void}
 */
export function revokeAllGroupFileBlobUrls() {
	for (const url of trackedBlobUrls)
		URL.revokeObjectURL(url)
	trackedBlobUrls.clear()
}

/**
 * @param {string} groupId 群 ID
 * @param {string} fileId 文件 ID
 * @returns {Promise<string | null>} Blob URL；失败已 toast 时为 null
 */
async function loadGroupFileBlobUrl(groupId, fileId) {
	try {
		const url = await fetchGroupFileAsBlobUrl(groupId, fileId)
		trackedBlobUrls.add(url)
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
		return renderTemplateAsHtmlString('hub/messages/inline_audio', { src: escapeHtml(blobUrl) })
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
	return `<div class="message-files flex flex-col gap-1 mt-1">${rows.join('')}</div>`
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
		const src = escapeHtml(blobUrl)
		const html = mime.startsWith('video/')
			? await renderTemplateAsHtmlString('hub/messages/inline_video', { src })
			: mime.startsWith('audio/')
				? await renderTemplateAsHtmlString('hub/messages/inline_audio', { src })
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
		bindBlobUrlCleanup(node)
	})
}
