/**
 * 【文件】public/hub/messages/render/file.mjs
 * 【职责】DAG fileIds 附件区渲染与懒加载媒体占位点击。
 */
import {
	createDocumentFragmentFromHtmlStringNoScriptActivation,
	renderTemplateAsHtmlString,
} from '../../../../../../scripts/features/template.mjs'
import { fetchGroupFileAsBlobUrl } from '../../../src/groupFileBlob.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { store } from '../../core/state.mjs'

import { getMessageText } from './text.mjs'

const LAZY_MEDIA_BYTES = 2 * 1024 * 1024

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
		const blobUrl = await fetchGroupFileAsBlobUrl(groupId, id)
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
		const blobUrl = await fetchGroupFileAsBlobUrl(groupId, id)
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
 * 渲染 DAG `fileIds` 附件区（图/音视频/懒加载/下载）。
 * @param {object} message 消息行
 * @returns {Promise<string>} HTML 片段
 */
export async function renderMessageFileIdsHtml(message) {
	const fileIds = message.content?.fileIds
	const fileAlts = message.content?.fileAlts || {}
	const groupId = store.context.currentGroupId
	if (!groupId || !Array.isArray(fileIds) || !fileIds.length) return ''

	const text = getMessageText(message)
	const rows = []
	for (const fileId of fileIds) {
		const id = String(fileId || '').trim()
		if (!id) continue
		const metaR = await fetch(
			`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/files/${encodeURIComponent(id)}/meta`,
			{ credentials: 'include' },
		)
		if (!metaR.ok) {
			rows.push(await renderTemplateAsHtmlString('hub/messages/media_error', {}))
			continue
		}
		const meta = await metaR.json()
		const mime = String(meta.mimeType || '')
		if (mime.startsWith('image/') && text.includes('[image:')) continue
		const alt = fileAlts[id] || meta.description || ''
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
		const blobUrl = await fetchGroupFileAsBlobUrl(groupId, fileId)
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
		if (node) placeholder.replaceWith(node)
	})
}
