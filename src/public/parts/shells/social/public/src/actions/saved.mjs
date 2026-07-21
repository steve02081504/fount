import { parseActionKey } from '../lib/actionKey.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import { confirmAction, promptText } from '../lib/dialog.mjs'
import { loadSaved, openSaveModal, setSavedFilter } from '../views/saved.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

/**
 * 处理收藏夹与保存帖子相关点击。
 * @param {HTMLElement} target 点击目标
 * @returns {Promise<void>}
 */
export async function handleSavedClick(target) {
	const filterTab = target.closest('[data-saved-filter]')
	if (filterTab instanceof HTMLElement && filterTab.dataset.savedFilter) {
		setSavedFilter(filterTab.dataset.savedFilter)
		return
	}

	const renameFolderButton = target.closest('[data-rename-folder]')
	if (renameFolderButton instanceof HTMLElement && renameFolderButton.dataset.renameFolder) {
		const name = await promptText(geti18n('social.saved.renameFolderPrompt'))
		if (!name) return
		await socialApi('/saved-posts/folders/rename', {
			method: 'POST',
			body: JSON.stringify({ folderId: renameFolderButton.dataset.renameFolder, name }),
		})
		await loadSaved()
		return
	}

	const deleteFolderButton = target.closest('[data-delete-folder]')
	if (deleteFolderButton instanceof HTMLElement && deleteFolderButton.dataset.deleteFolder) {
		if (!await confirmAction(geti18n('social.saved.deleteFolderConfirm'))) return
		await socialApi('/saved-posts/folders/delete', {
			method: 'POST',
			body: JSON.stringify({ folderId: deleteFolderButton.dataset.deleteFolder }),
		})
		await loadSaved()
		return
	}

	if (target.closest('#createFolderButton')) {
		const name = await promptText(geti18n('social.saved.createFolderPrompt'))
		if (!name) return
		await socialApi('/saved-posts/folders', { method: 'POST', body: JSON.stringify({ name }) })
		await loadSaved()
		return
	}

	const saveButton = target.closest('[data-save]')
	if (saveButton instanceof HTMLElement && saveButton.dataset.save) {
		const parsed = parseActionKey(saveButton.dataset.save)
		if (parsed)
			await openSaveModal(parsed.entityHash, parsed.postId, saveButton)
		return
	}

	const removeSavedButton = target.closest('[data-remove-saved]')
	if (removeSavedButton instanceof HTMLElement && removeSavedButton.dataset.removeSaved) {
		const parsed = parseActionKey(removeSavedButton.dataset.removeSaved)
		if (parsed) {
			const { entityHash, postId } = parsed
			const folderId = removeSavedButton.dataset.savedFolder || undefined
			await socialApi('/saved-posts/remove', {
				method: 'POST',
				body: JSON.stringify({
					entityHash,
					postId,
					...folderId ? { folderId } : {},
				}),
			})
			await loadSaved()
		}
	}
}
