import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { loadDraftIntoComposer, saveComposerDraft } from '../composer.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import { focusComposer, switchView } from '../navigation.mjs'
import { state } from '../state.mjs'
import { removeDraft } from '../views/drafts.mjs'

/**
 * 处理草稿箱相关点击。
 * @param {HTMLElement} target 点击目标
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleDraftsClick(target) {
	if (target.closest('#saveDraftButton')) {
		try {
			await saveComposerDraft()
		}
		catch (error) {
			const err = error instanceof Error ? error : new Error(String(error))
			showToastI18n('error', 'social.drafts.saveFailed', { error: err.message })
		}
		return true
	}

	const openBtn = target.closest('[data-open-draft]')
	if (openBtn instanceof HTMLElement && openBtn.dataset.openDraft) {
		const draftId = openBtn.dataset.openDraft
		try {
			const row = await socialApi(`/drafts/${encodeURIComponent(draftId)}`)
			await switchView('feed')
			await loadDraftIntoComposer(row)
			await focusComposer()
		}
		catch (error) {
			const err = error instanceof Error ? error : new Error(String(error))
			showToastI18n('error', 'social.drafts.loadFailed', { error: err.message })
		}
		return true
	}

	const deleteBtn = target.closest('[data-delete-draft]')
	if (deleteBtn instanceof HTMLElement && deleteBtn.dataset.deleteDraft) {
		const draftId = deleteBtn.dataset.deleteDraft
		if (state.activeDraftId === draftId)
			state.activeDraftId = null
		await removeDraft(draftId)
		return true
	}

	return false
}
