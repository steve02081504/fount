/**
 * 【文件】public/hub/messages/render/reactions.mjs
 * 【职责】消息行内表情反应条 HTML。
 */
import { resolveEmojiRefLabel, resolvePackEmojiUrl } from '/scripts/features/emoji/packIndex.mjs'
import { parseEmojiRef } from '../../../shared/inlineTokenSyntax.mjs'
import { isDagEventId } from '../../../src/lib/eventId.mjs'
import { renderTemplateAsHtmlString } from '../../../src/templates.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { tallyReactionsFromMap } from '../../../src/ui/channelDisplay.mjs'

/** 可嵌入的 src 前缀（data URL / http(s) / API 路径）。 */
const EMBEDDABLE_SRC_RE = /^(data:|https?:\/\/|\/)/u

/**
 * 渲染单个反应 chip 内容：pack 表情渲染 `<img>`，unicode 渲染字形。
 * @param {string} emoji reaction 键（emojiRef）
 * @returns {Promise<{ emojiHtml: string, emojiLabel: string }>} 展示 HTML 与读屏 label
 */
async function renderReactionChip(emoji) {
	const parsed = parseEmojiRef(emoji)
	if (parsed?.kind === 'unicode') {
		const glyph = escapeHtml(parsed.unicode)
		return { emojiHtml: glyph, emojiLabel: glyph }
	}
	if (!parsed) return { emojiHtml: escapeHtml(String(emoji)), emojiLabel: escapeHtml(String(emoji)) }
	const [url, label] = await Promise.all([
		resolvePackEmojiUrl(parsed.packId, parsed.emojiId),
		resolveEmojiRefLabel(emoji),
	])
	if (url && EMBEDDABLE_SRC_RE.test(url))
		return {
			emojiHtml: `<img class="reaction-emoji-img" src="${escapeHtml(url)}" alt="" loading="lazy" svg-inliner-ignore />`,
			emojiLabel: escapeHtml(label),
		}
	return { emojiHtml: escapeHtml(label), emojiLabel: escapeHtml(label) }
}

/**
 * @param {object} message 消息行
 * @param {Record<string, Record<string, { voters?: string[] }>>} reactionsMap 当前页聚合反应
 * @param {string} viewerMemberId 本机成员 pubKeyHash 或 `local`
 * @param {{ canAddReactions?: boolean }} [options] 渲染选项
 * @returns {Promise<string>} HTML
 */
export async function renderMessageReactionsHtml(message, reactionsMap, viewerMemberId, options = {}) {
	const { eventId } = message
	if (!eventId || message.type !== 'message' || !isDagEventId(eventId)) return ''
	const reactions = tallyReactionsFromMap(reactionsMap, eventId, viewerMemberId)
	const canAdd = !!options.canAddReactions
	if (!reactions.size && !canAdd) return ''
	const reactionRows = await Promise.all([...reactions.entries()].map(async ([emoji, { count, byMe }]) => {
		const { emojiHtml, emojiLabel } = await renderReactionChip(emoji)
		return {
			mineClass: byMe ? ' badge-primary' : '',
			pressedAttr: byMe ? ' aria-pressed="true"' : ' aria-pressed="false"',
			emoji: escapeHtml(String(emoji)),
			emojiHtml,
			emojiLabel,
			count,
		}
	}))
	return renderTemplateAsHtmlString('hub/messages/reactions_row', {
		eventId: escapeHtml(String(eventId)),
		reactionRows,
		canAddReactions: canAdd,
	})
}
