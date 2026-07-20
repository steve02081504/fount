/**
 * 【文件】public/hub/messages/render/reactions.mjs
 * 【职责】消息行内表情反应条 HTML。
 */
import { renderTemplateAsHtmlString } from '../../../../../../scripts/features/template.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { isDagEventId } from '../../../src/lib/eventId.mjs'
import { tallyReactionsFromMap } from '../../../src/ui/channelDisplay.mjs'

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
	const reactionRows = [...reactions.entries()].map(([emoji, { count, byMe }]) => ({
		mineClass: byMe ? ' badge-primary' : '',
		pressedAttr: byMe ? ' aria-pressed="true"' : ' aria-pressed="false"',
		emoji: escapeHtml(String(emoji)),
		emojiLabel: escapeHtml(String(emoji)),
		count,
	}))
	return renderTemplateAsHtmlString('hub/messages/reactions_row', {
		eventId: escapeHtml(String(eventId)),
		reactionRows,
		canAddReactions: canAdd,
	})
}
