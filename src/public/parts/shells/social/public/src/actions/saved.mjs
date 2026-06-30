import { parseActionKey } from '../lib/actionKey.mjs'
import { loadSaved, openSaveModal } from '../views/saved.mjs'

/**
 * 处理收藏夹与保存帖子相关点击。
 * @param {object} appContext 应用上下文
 * @param {HTMLElement} target 点击目标
 * @returns {Promise<void>}
 */
export async function handleSavedClick(appContext, target) {
	const renameFolderBtn = target.closest('[data-rename-folder]')
	if (renameFolderBtn instanceof HTMLElement && renameFolderBtn.dataset.renameFolder) {
		const name = window.prompt(appContext.geti18n('social.saved.renameFolderPrompt'), '')
		if (!name?.trim()) return
		await appContext.socialApi('/saved-posts/folders/rename', {
			method: 'POST',
			body: JSON.stringify({ folderId: renameFolderBtn.dataset.renameFolder, name: name.trim() }),
		})
		await loadSaved(appContext)
	}

	const deleteFolderBtn = target.closest('[data-delete-folder]')
	if (deleteFolderBtn instanceof HTMLElement && deleteFolderBtn.dataset.deleteFolder) {
		if (!window.confirm(appContext.geti18n('social.saved.deleteFolderConfirm'))) return
		await appContext.socialApi('/saved-posts/folders/delete', {
			method: 'POST',
			body: JSON.stringify({ folderId: deleteFolderBtn.dataset.deleteFolder }),
		})
		await loadSaved(appContext)
	}

	if (target.closest('#createFolderBtn')) {
		const name = document.getElementById('newFolderName')?.value.trim()
		if (!name) return
		await appContext.socialApi('/saved-posts/folders', { method: 'POST', body: JSON.stringify({ name }) })
		await loadSaved(appContext)
	}

	const saveBtn = target.closest('[data-save]')
	if (saveBtn instanceof HTMLElement && saveBtn.dataset.save) {
		const parsed = parseActionKey(saveBtn.dataset.save)
		if (parsed)
			await openSaveModal(appContext, parsed.entityHash, parsed.postId, saveBtn)
	}

	const removeSavedBtn = target.closest('[data-remove-saved]')
	if (removeSavedBtn instanceof HTMLElement && removeSavedBtn.dataset.removeSaved) {
		const parsed = parseActionKey(removeSavedBtn.dataset.removeSaved)
		if (parsed) {
			const { entityHash, postId } = parsed
			const folderId = removeSavedBtn.dataset.savedFolder || undefined
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
