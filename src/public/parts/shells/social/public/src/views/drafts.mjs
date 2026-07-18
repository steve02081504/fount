import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { escapeHtml } from '../../../../../scripts/lib/escapeHtml.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import { formatTimeHtml } from '../lib/display.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

/**
 * 渲染草稿箱列表。
 * @returns {Promise<void>}
 */
export async function loadDrafts() {
	const panel = document.getElementById('draftsPanel')
	if (!panel) return
	const data = await socialApi('/drafts')
	const drafts = Array.isArray(data.drafts) ? data.drafts : []
	if (!drafts.length) {
		panel.innerHTML = `
			<div class="empty-state">
				<p>${escapeHtml(geti18n('social.empty.drafts'))}</p>
				<p class="saved-empty-hint">${escapeHtml(geti18n('social.drafts.emptyHint'))}</p>
			</div>
		`
		return
	}
	panel.innerHTML = `<div class="drafts-list">${drafts.map(row => {
		const preview = String(row.preview || '').trim() || geti18n('social.drafts.untitled')
		return `
			<article class="draft-row" data-draft-id="${escapeHtml(row.draftId)}">
				<button type="button" class="draft-row-main" data-open-draft="${escapeHtml(row.draftId)}">
					<p class="draft-row-preview">${escapeHtml(preview)}</p>
					${formatTimeHtml(row.updatedAt, 'draft-row-meta')}
				</button>
				<button type="button" class="draft-row-action" data-delete-draft="${escapeHtml(row.draftId)}" aria-label="${escapeHtml(geti18n('social.drafts.delete'))}">
					<span class="s-ic s-ic-delete" aria-hidden="true"></span>
				</button>
			</article>
		`
	}).join('')}</div>`
}

/**
 * 删除草稿并刷新列表。
 * @param {string} draftId id
 * @returns {Promise<void>}
 */
export async function removeDraft(draftId) {
	try {
		await socialApi(`/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' })
		await loadDrafts()
		showToastI18n('success', 'social.drafts.deleted')
	}
	catch (error) {
		const err = error instanceof Error ? error : new Error(String(error))
		showToastI18n('error', 'social.drafts.deleteFailed', { error: err.message })
	}
}
