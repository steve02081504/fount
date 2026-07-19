/**
 * 【文件】public/hub/messages/exportHtml.mjs
 * 【职责】消息 → 可离线独立 HTML 文档（正文 + 群附件 data URL）。
 */
import {
	downloadHtmlDocument,
	materializeStandaloneAttachments,
	renderMarkdownAsStandaloneDocument,
} from '../../../../../scripts/features/markdown/standaloneDocument.mjs'
import { arrayBufferToBase64 } from '../../../../../scripts/lib/base64.mjs'
import { entityFileUrl } from '../../shared/evfsMedia.mjs'
import { groupEntityHash } from '../../shared/groupEntityHash.mjs'
import { store } from '../core/state.mjs'

import { getMessageText } from './render/text.mjs'

/**
 * @param {string} groupId 群 ID
 * @param {string[]} fileIds 文件 ID
 * @returns {Promise<object[]>} standalone 附件
 */
async function resolveGroupFileAttachments(groupId, fileIds) {
	if (!groupId || !fileIds?.length) return []
	const entityHash = groupEntityHash(groupId)
	const files = []
	for (const fileId of fileIds) {
		const id = String(fileId || '').trim()
		if (!id) continue
		const metaR = await fetch(
			`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/files/${encodeURIComponent(id)}/meta`,
			{ credentials: 'include' },
		)
		if (!metaR.ok) continue
		const meta = await metaR.json()
		const plainR = await fetch(entityFileUrl(entityHash, `chat/${id}`), { credentials: 'include' })
		if (!plainR.ok) continue
		const mime = String(meta.mimeType || plainR.headers.get('Content-Type') || 'application/octet-stream')
		files.push({
			name: meta.name || id,
			mime_type: mime,
			buffer: arrayBufferToBase64(await plainR.arrayBuffer()),
		})
	}
	return files
}

/**
 * @param {object | null | undefined} message 消息
 * @param {HTMLElement | null} [row] DOM 行（兜底取正文）
 * @param {{ includeFiles?: boolean, groupId?: string }} [options] 选项
 * @returns {Promise<string>} 完整 HTML 文档
 */
export async function generateMessageStandaloneHtml(message, row = null, options = {}) {
	const markdown = getMessageText(message)
		|| row?.querySelector('.message-content')?.textContent?.trim()
		|| ''
	const includeFiles = options.includeFiles !== false
	const groupId = options.groupId || store.context.currentGroupId
	const fileIds = includeFiles ? message?.content?.fileIds : null
	const files = await materializeStandaloneAttachments(
		await resolveGroupFileAttachments(groupId, fileIds),
	)
	return renderMarkdownAsStandaloneDocument(markdown, { files })
}

/**
 * 下载消息为独立 HTML。
 * @param {object | null | undefined} message 消息
 * @param {HTMLElement | null} [row] DOM 行
 * @param {string} [fileName] 文件名
 * @returns {Promise<void>}
 */
export async function downloadMessageHtml(message, row = null, fileName) {
	const html = await generateMessageStandaloneHtml(message, row)
	downloadHtmlDocument(html, fileName || `message-${message?.eventId || 'export'}.html`)
}
