/**
 * 【文件】public/hub/messages/render/vote.mjs
 * 【职责】投票卡片 HTML。
 */
import { renderTemplateAsHtmlString } from '../../../../../../scripts/features/template.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { tallyVoteChoices } from '../../../src/lib/voteTally.mjs'

/**
 * 渲染投票消息块。
 * @param {object} message 投票行
 * @param {object[]} allMessages 同频道全部行
 * @returns {Promise<string>} HTML
 */
export async function renderVoteBlock(message, allMessages) {
	const content = message?.content || {}
	const question = escapeHtml(String(content.question || ''))
	const options = Array.isArray(content.options) ? content.options : []
	const ballotId = escapeHtml(String(message.eventId))
	const counts = tallyVoteChoices(allMessages, message.eventId)
	const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
	const closed = content.deadline && Date.parse(content.deadline) <= Date.now()
	const deadlineHtml = content.deadline
		? await renderTemplateAsHtmlString('hub/messages/vote_deadline', { deadline: String(content.deadline) })
		: ''
	const voteOptions = options.map(label => {
		const key = String(label)
		const voteCount = counts.get(key) || 0
		const percent = total ? Math.round(voteCount * 100 / total) : 0
		return {
			choice: escapeHtml(key),
			label: escapeHtml(key),
			count: voteCount,
			percent,
			disabled: closed ? 'disabled' : '',
		}
	})
	const questionHtml = question || '<span data-i18n="chat.hub.messagePrefixVote"></span>'
	return renderTemplateAsHtmlString('hub/messages/vote_block', {
		ballotId,
		questionHtml,
		deadlineHtml,
		voteOptions,
		total,
		closedClass: closed ? ' hub-vote-block--closed' : '',
		closedLabel: closed ? '<div class="hub-vote-closed-label" data-i18n="chat.hub.voteClosed"></div>' : '',
	})
}
