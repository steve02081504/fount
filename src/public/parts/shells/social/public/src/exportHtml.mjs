/**
 * Social 帖子 → 可离线独立 HTML 文档。
 */
import {
	downloadHtmlDocument,
	materializeStandaloneAttachments,
	renderMarkdownAsStandaloneDocument,
} from '/scripts/features/markdown/standaloneDocument.mjs'
import { arrayBufferToBase64 } from '/scripts/lib/base64.mjs'
import { fetchMediaRef } from '/scripts/endpoints/p2p/evfsMedia.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'

/**
 * @param {object[] | undefined} mediaRefs 媒体引用
 * @returns {Promise<object[]>} standalone 附件
 */
async function resolveMediaRefAttachments(mediaRefs) {
	if (!mediaRefs?.length) return []
	const files = []
	for (const ref of mediaRefs) 
		try {
			const name = ref.name || ref.path?.split('/').pop() || 'media'
			const { buffer, mimeType } = await fetchMediaRef(ref)
			files.push({ name, mime_type: String(ref.mimeType || mimeType), buffer: arrayBufferToBase64(buffer) })
		}
		catch (error) {
			handleError('social.post.exportMediaFailed', {}, error)
			throw error
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
 * 下载帖子为独立 HTML（文件名取自文档 `<title>`）。
 * @param {{ text?: string, mediaRefs?: object[] }} content 帖子 content
 * @param {string} [fileName] 覆盖文件名；省略则用 title
 * @returns {Promise<void>}
 */
export async function downloadPostHtml(content, fileName) {
	const html = await generatePostStandaloneHtml(content)
	downloadHtmlDocument(html, fileName)
}
