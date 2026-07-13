import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

/**
 * @param {object} poll poll 态
 * @param {string} actionKey 帖子 action key
 * @param {(key: string, params?: object) => string} geti18n i18n
 * @returns {string} poll HTML
 */
export function renderPollHtml(poll, actionKey, geti18n) {
	if (!poll?.options?.length) return ''
	const [entityHash, postId] = actionKey.split(':')
	const closed = poll.closed === true
	const tally = poll.tally || {}
	const total = Object.values(tally).reduce((sum, n) => sum + Number(n), 0) || 0
	const viewerChoices = new Set(poll.viewerChoices || [])
	const optionsHtml = poll.options.map((label, index) => {
		const count = Number(tally[String(index)] || 0)
		const pct = total ? Math.round((count / total) * 100) : 0
		const selected = viewerChoices.has(index) ? ' poll-option-selected' : ''
		const disabled = closed || poll.viewerChoices?.length ? ' disabled' : ''
		return `<button type="button" class="poll-option${selected}" data-poll-vote="${escapeHtml(actionKey)}" data-poll-choice="${index}"${disabled}>
			<span class="poll-option-label">${escapeHtml(label)}</span>
			<span class="poll-option-bar"><span class="poll-option-fill" style="width:${pct}%"></span></span>
			<span class="poll-option-meta">${count}${total ? ` (${pct}%)` : ''}</span>
		</button>`
	}).join('')
	const status = closed
		? geti18n('social.poll.closed')
		: poll.deadline
			? geti18n('social.poll.deadline', { deadline: poll.deadline })
			: ''
	return `<div class="post-poll" data-poll-for="${escapeHtml(actionKey)}">
		<div class="post-poll-status">${escapeHtml(status)}</div>
		<div class="poll-options">${optionsHtml}</div>
	</div>`
}

/**
 * @param {object} appContext 应用上下文
 * @param {HTMLElement} target 点击目标
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handlePollVoteClick(appContext, target) {
	const button = target.closest('[data-poll-vote]')
	if (!(button instanceof HTMLElement) || button.disabled) return false
	const actionKey = button.dataset.pollVote
	const choice = Number(button.dataset.pollChoice)
	if (!actionKey || !Number.isInteger(choice)) return false
	const [entityHash, postId] = actionKey.split(':')
	if (!entityHash || !postId) return false
	await appContext.socialApi(`/posts/${encodeURIComponent(entityHash)}/${encodeURIComponent(postId)}/poll-vote`, {
		method: 'POST',
		body: JSON.stringify({ choices: [choice] }),
	})
	const { refreshVisiblePosts } = await import('./navigation.mjs')
	await refreshVisiblePosts(appContext)
	return true
}
