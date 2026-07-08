import { parseActionKey } from '../lib/actionKey.mjs'
import { loadSaved, openSaveModal } from '../views/saved.mjs'

/**
 * 处理收藏夹与保存帖子相关点击。
 * @param {object} appContext 应用上下文
 * @param {HTMLElement} target 点击目标
 * @returns {Promise<void>}
 */
export async function handleSavedClick(appContext, target) {
	const renameFolderButton = target.closest('[data-rename-folder]')
	if (renameFolderButton instanceof HTMLElement && renameFolderButton.dataset.renameFolder) {
		const name = window.prompt(appContext.geti18n('social.saved.renameFolderPrompt'), '')
		if (!name?.trim()) return
		await appContext.socialApi('/saved-posts/folders/rename', {
			method: 'POST',
			body: JSON.stringify({ folderId: renameFolderButton.dataset.renameFolder, name: name.trim() }),
		})
		await loadSaved(appContext)
	}

	const deleteFolderButton = target.closest('[data-delete-folder]')
	if (deleteFolderButton instanceof HTMLElement && deleteFolderButton.dataset.deleteFolder) {
		if (!window.confirm(appContext.geti18n('social.saved.deleteFolderConfirm'))) return
		await appContext.socialApi('/saved-posts/folders/delete', {
			method: 'POST',
			body: JSON.stringify({ folderId: deleteFolderButton.dataset.deleteFolder }),
		})
		await loadSaved(appContext)
	}

	if (target.closest('#createFolderButton')) {
		const name = document.getElementById('newFolderName')?.value.trim()
		if (!name) return
		await appContext.socialApi('/saved-posts/folders', { method: 'POST', body: JSON.stringify({ name }) })
		await loadSaved(appContext)
	}

	const saveButton = target.closest('[data-save]')
	if (saveButton instanceof HTMLElement && saveButton.dataset.save) {
		const parsed = parseActionKey(saveButton.dataset.save)
		if (parsed)
			await openSaveModal(appContext, parsed.entityHash, parsed.postId, saveButton)
	}

	const removeSavedButton = target.closest('[data-remove-saved]')
	if (removeSavedButton instanceof HTMLElement && removeSavedButton.dataset.removeSaved) {
		const parsed = parseActionKey(removeSavedButton.dataset.removeSaved)
		if (parsed) {
			const { entityHash, postId } = parsed
			const folderId = removeSavedButton.dataset.savedFolder || undefined
			await appContext.socialApi('/saved-posts/remove', {
				method: 'POST',
				body: JSON.stringify({
					entityHash,
					postId,
					...folderId ? { folderId } : {},
				}),
			})
			await loadSaved(appContext)
		}
	}
}
