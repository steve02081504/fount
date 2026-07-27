import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { escapeHtml } from '../../../../../scripts/lib/escapeHtml.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import { formatTimeHtml } from '../lib/display.mjs'
import { buildEmptyState } from '../lib/emptyState.mjs'
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
		panel.replaceChildren(await buildEmptyState({
			modClass: ' empty-state--saved empty-state--compact',
			titleKey: 'social.empty.drafts',
			hintKey: 'social.drafts.emptyHint',
		}))
		return
	}
	panel.innerHTML = `<ul class="drafts-list list">${drafts.map(row => {
		const preview = String(row.preview || '').trim() || geti18n('social.drafts.untitled')
		return `
			<li class="list-row draft-row" data-draft-id="${escapeHtml(row.draftId)}">
				<button type="button" class="draft-row-main flex flex-col items-start gap-1 flex-1 min-w-0 text-left bg-transparent border-0 text-inherit cursor-pointer p-0" data-open-draft="${escapeHtml(row.draftId)}">
					<p class="draft-row-preview">${escapeHtml(preview)}</p>
					${formatTimeHtml(row.updatedAt, 'draft-row-meta')}
				</button>
				<button type="button" class="btn btn-ghost btn-sm btn-circle draft-row-action" data-delete-draft="${escapeHtml(row.draftId)}" aria-label="${escapeHtml(geti18n('social.drafts.delete'))}">
					<span class="icon icon-delete" aria-hidden="true"></span>
				</button>
			</li>
		`
	}).join('')}</ul>`
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
