import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

import { runSocialWrite } from '../lib/socialWrite.mjs'

/**
 * 加载并渲染审核队列。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function loadModeration(appContext) {
	const list = document.getElementById('moderationList')
	if (!list) return
	const data = await appContext.socialApi('/governance/reports?limit=50')
	const reports = data.reports || []
	if (!reports.length) {
		list.innerHTML = `<p class="empty-hint">${escapeHtml(appContext.geti18n('social.moderation.empty'))}</p>`
		return
	}
	list.replaceChildren()
	for (const report of reports) {
		const row = document.createElement('article')
		row.className = 'moderation-row'
		row.innerHTML = `
			<div class="moderation-meta">
				<strong>${escapeHtml(report.category || 'other')}</strong>
				<span>${escapeHtml(report.reason || '')}</span>
				<span class="moderation-target">${escapeHtml(report.targetEntityHash?.slice(0, 16) || '')}…</span>
			</div>
			<div class="moderation-actions">
				<button type="button" class="btn btn-ghost btn-xs" data-resolve="${escapeHtml(report.id)}" data-action="dismiss">${escapeHtml(appContext.geti18n('social.moderation.dismiss'))}</button>
				<button type="button" class="btn btn-ghost btn-xs" data-resolve="${escapeHtml(report.id)}" data-action="mute_author">${escapeHtml(appContext.geti18n('social.moderation.muteAuthor'))}</button>
				<button type="button" class="btn btn-ghost btn-xs" data-resolve="${escapeHtml(report.id)}" data-action="hide_post">${escapeHtml(appContext.geti18n('social.moderation.hidePost'))}</button>
			</div>`
		list.appendChild(row)
	}
	list.querySelectorAll('[data-resolve]').forEach(button => {
		button.addEventListener('click', () => {
			const reportId = button.getAttribute('data-resolve')
			const action = button.getAttribute('data-action')
			if (!reportId || !action) return
			void runSocialWrite('moderation', () => appContext.socialApi('/governance/reports/resolve', {
				method: 'POST',
				body: JSON.stringify({ reportId, action }),
			})).then(() => loadModeration(appContext))
		})
	})
}
