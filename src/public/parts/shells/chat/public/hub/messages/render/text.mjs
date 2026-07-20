/**
 * 【文件】public/hub/messages/render/text.mjs
 * 【职责】消息正文文本提取、内联贴纸/图片标记展开、生成中判定。
 */
import { renderTemplateAsHtmlString } from '../../../../../../scripts/features/template.mjs'
import { channelMessageEditText, channelMessageShowText } from '../../../shared/channelContent.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

/**
 * @param {string} url 已转义 URL
 * @returns {string} 属性用 URL
 */
function unescapeAttrUrl(url) {
	return url.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

/**
 * @param {string} str 源字符串
 * @param {RegExp} regex 全局正则
 * @param {(...args: string[]) => Promise<string>} replacer 替换函数
 * @returns {Promise<string>} 替换后字符串
 */
async function replaceAsync(str, regex, replacer) {
	const parts = []
	let lastIndex = 0
	for (const match of str.matchAll(regex)) {
		const index = match.index ?? 0
		if (index > lastIndex) parts.push(str.slice(lastIndex, index))
		parts.push(await replacer(...match))
		lastIndex = index + match[0].length
	}
	if (lastIndex < str.length) parts.push(str.slice(lastIndex))
	return parts.join('')
}

/**
 * @param {object} message 消息行
 * @returns {boolean} 是否为流式生成占位
 */
export function isChannelMessageGenerating(message) {
	if (message?.type !== 'message') return false
	if (message.content?.streamGenerationFailed) return false
	return message.content?.is_generating === true
}

/**
 * @param {object} message 消息行
 * @param {object} renderOpts 渲染选项
 * @returns {boolean} 是否为本机用户消息（右对齐）
 */
export function isOwnViewerMessage(message, renderOpts) {
	if (message.charId) return false
	if (message.isRemote) return false
	const viewer = String(renderOpts.viewerPubKeyHash || '').trim().toLowerCase()
	const author = String(message.authorPubKeyHash || '').trim().toLowerCase()
	if (viewer && author) return viewer === author
	return !message.charId
}

/**
 * 从消息对象中提取纯文本内容（不含 GSH 解密占位）。
 * @param {{ content?: * }} message 群组或频道消息
 * @returns {string} 展示用文本
 */
export function getMessageText(message) {
	if (message?.decryptView?.failed) return ''
	return channelMessageShowText(message?.content)
}

/**
 * @param {object} message 消息行
 * @returns {string} 编辑用正文（`content_for_edit` 回落 `content`）
 */
export function getMessageEditText(message) {
	return channelMessageEditText(message?.content)
}

/**
 * 将纯文本转为可插入消息区的 HTML（贴纸/图片占位等）。
 * @param {string} text 原始消息文本
 * @returns {Promise<string>} 带内联标签的 HTML
 */
export async function renderMessageContent(text) {
	let html = escapeHtml(text)
	html = await replaceAsync(html, /\[sticker:([^\]|]+)\|([^\]]+)]/g, async (...[, stickerId, stickerUrl]) =>
		renderTemplateAsHtmlString('hub/messages/inline_sticker_img', {
			stickerId: escapeHtml(stickerId),
			src: escapeHtml(unescapeAttrUrl(stickerUrl)),
		}),
	)
	html = await replaceAsync(html, /\[image:([^\]|]+)\|([^\]]+)]/g, async (...[, fileName, imageUrl]) => {
		const safeUrl = escapeHtml(unescapeAttrUrl(imageUrl))
		return renderTemplateAsHtmlString('hub/messages/inline_image', {
			fileName: escapeHtml(fileName),
			src: safeUrl,
		})
	})
	return html
}
