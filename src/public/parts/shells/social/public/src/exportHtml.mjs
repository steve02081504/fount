/**
 * Social 帖子 → 可离线独立 HTML 文档。
 */
import {
	downloadHtmlDocument,
	materializeStandaloneAttachments,
	renderMarkdownAsStandaloneDocument,
} from '/scripts/features/markdown/standaloneDocument.mjs'
import { arrayBufferToBase64 } from '/scripts/lib/base64.mjs'
import { mediaRefUrl } from '/parts/shells:chat/shared/evfsMedia.mjs'

/**
 * @param {object[] | undefined} mediaRefs 媒体引用
 * @returns {Promise<object[]>} standalone 附件
 */
async function resolveMediaRefAttachments(mediaRefs) {
	if (!mediaRefs?.length) return []
	const files = []
	for (const ref of mediaRefs) {
		let url
		try {
			url = mediaRefUrl(ref)
		}
		catch {
			continue
		}
		const res = await fetch(url, { credentials: 'include' })
		if (!res.ok) continue
		const mime = String(ref.mimeType || res.headers.get('Content-Type') || 'application/octet-stream')
		files.push({
			name: ref.name || ref.path?.split('/').pop() || 'media',
			mime_type: mime,
			buffer: arrayBufferToBase64(await res.arrayBuffer()),
		})
	}
	return files
}

/**
 * @param {{ text?: string, mediaRefs?: object[] }} content 帖子 content
 * @returns {Promise<string>} 完整 HTML
 */
export async function generatePostStandaloneHtml(content = {}) {
	const markdown = content.text || ''
	const files = await materializeStandaloneAttachments(
		await resolveMediaRefAttachments(content.mediaRefs),
	)
	return renderMarkdownAsStandaloneDocument(markdown, { files })
}

/**
 * 下载帖子为独立 HTML。
 * @param {{ text?: string, mediaRefs?: object[] }} content 帖子 content
 * @param {string} [fileName] 文件名
 * @returns {Promise<void>}
 */
export async function downloadPostHtml(content, fileName) {
	const html = await generatePostStandaloneHtml(content)
	downloadHtmlDocument(html, fileName || 'post-export.html')
}
