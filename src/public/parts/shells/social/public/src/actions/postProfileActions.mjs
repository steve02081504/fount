import { formatSocialShareHttpsUrl } from '../../shared/protocolUrl.mjs'
import { parseActionKey } from '../lib/actionKey.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import { promptText, promptTextArea, showText } from '../lib/dialog.mjs'
import { handlePollVoteClick } from '../lib/pollUi.mjs'
import { purgeFeedShownPost, restoreFeedShownItems, runWrite } from '../lib/socialWrite.mjs'
import { refreshVisiblePosts } from '../navigation.mjs'
import { state } from '../state.mjs'

import { closePostMoreMenus, copyTextToClipboard, flashCopiedLabel, shareOrCopyPostLink } from './shared.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

/**
 * @param {HTMLElement} target 点击目标元素
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handlePostProfileActionsClick(target) {
	if (await handlePollVoteClick(target)) return true

	const editButton = target.closest('[data-edit]')
	if (editButton instanceof HTMLElement && editButton.dataset.edit) {
		const parsed = parseActionKey(editButton.dataset.edit)
		if (parsed) {
			closePostMoreMenus()
			const card = editButton.closest('.post-card')
			const current = decodeURIComponent(card?.dataset.postText || '')
			const next = await promptText(geti18n('social.post.editPrompt'), current)
			if (next == null || next === current) return true
			await runWrite('edit', () => socialApi(
				`/posts/${encodeURIComponent(parsed.entityHash)}/${encodeURIComponent(parsed.postId)}/edit`,
				{ method: 'POST', body: JSON.stringify({ text: next }) },
			))
			await refreshVisiblePosts()
		}
		return true
	}

	const historyButton = target.closest('[data-edit-history]')
	if (historyButton instanceof HTMLElement && historyButton.dataset.editHistory) {
		const card = historyButton.closest('.post-card')
		const postId = card?.dataset.postId
		const author = card?.dataset.authorEntity
		if (postId && author) {
			closePostMoreMenus()
			void socialApi(`/profile/${encodeURIComponent(author)}/posts?limit=50`).then(async data => {
				const item = (data.items || []).find(row => row.postId === postId)
				const revisions = item?.post?.revisions || []
				const lines = revisions.map((rev, idx) => `#${idx + 1} ${rev.text || ''}`).join('\n---\n')
				await showText(lines || geti18n('social.post.editHistoryEmpty'), geti18n('social.post.editHistory'))
			})
		}
		return true
	}

	const addNoteButton = target.closest('[data-add-note]')
	if (addNoteButton instanceof HTMLElement && addNoteButton.dataset.addNote) {
		const parsed = parseActionKey(addNoteButton.dataset.addNote)
		if (parsed) {
			closePostMoreMenus()
			const text = await promptTextArea(geti18n('social.notes.prompt'))
			if (!text?.trim()) return true
			await runWrite('addNote', () => socialApi(
				`/posts/${encodeURIComponent(parsed.entityHash)}/${encodeURIComponent(parsed.postId)}/notes`,
				{ method: 'POST', body: JSON.stringify({ text: text.trim() }) },
			))
			await refreshVisiblePosts()
		}
		return true
	}

	const noteVoteButton = target.closest('[data-note-vote]')
	if (noteVoteButton instanceof HTMLElement && noteVoteButton.dataset.noteVote) {
		const parsed = parseActionKey(noteVoteButton.dataset.noteVote)
		const noteId = noteVoteButton.dataset.noteId
		if (parsed && noteId) {
			const helpful = noteVoteButton.dataset.helpful !== '0'
			await runWrite('noteVote', () => socialApi(
				`/posts/${encodeURIComponent(parsed.entityHash)}/${encodeURIComponent(parsed.postId)}/notes/${encodeURIComponent(noteId)}/vote`,
				{ method: 'POST', body: JSON.stringify({ helpful }) },
			))
			await refreshVisiblePosts()
		}
		return true
	}

	const noteMoreButton = target.closest('[data-note-more]')
	if (noteMoreButton instanceof HTMLElement && noteMoreButton.dataset.noteMore) {
		const parsed = parseActionKey(noteMoreButton.dataset.noteMore)
		if (parsed) {
			const data = await socialApi(
				`/posts/${encodeURIComponent(parsed.entityHash)}/${encodeURIComponent(parsed.postId)}/notes`,
			)
			await showText((data.notes || []).map(note =>
				`[${note.score >= 0 ? '+' : ''}${note.score}] ${note.text || ''}`).join('\n---\n')
				|| geti18n('social.notes.empty'), geti18n('social.notes.listTitle'))
		}
		return true
	}

	const copyLinkButton = target.closest('[data-copy-link]')
	if (copyLinkButton instanceof HTMLElement && copyLinkButton.dataset.copyLink) {
		const parsed = parseActionKey(copyLinkButton.dataset.copyLink)
		if (parsed) {
			const { entityHash, postId } = parsed
			await copyTextToClipboard(formatSocialShareHttpsUrl(entityHash, postId))
			flashCopiedLabel(copyLinkButton.querySelector('[data-i18n="social.actions.copyLink"]'))
			closePostMoreMenus()
		}
		return true
	}

	const shareButton = target.closest('[data-share]')
	if (shareButton instanceof HTMLElement && shareButton.dataset.share) {
		const parsed = parseActionKey(shareButton.dataset.share)
		if (parsed) {
			const result = await shareOrCopyPostLink(parsed.entityHash, parsed.postId)
			if (result === 'copied')
				flashCopiedLabel(
					shareButton.querySelector('[data-i18n="social.actions.share"]')
						|| shareButton.querySelector('.action-count'),
				)
			closePostMoreMenus()
		}
		return true
	}

	const moreToggle = target.closest('[data-more-toggle]')
	if (moreToggle instanceof HTMLElement && moreToggle.dataset.moreToggle) {
		const card = moreToggle.closest('.post-card')
		const menu = card?.querySelector(`[data-more-menu="${CSS.escape(moreToggle.dataset.moreToggle)}"]`)
			|| document.querySelector(`[data-more-menu="${CSS.escape(moreToggle.dataset.moreToggle)}"]`)
		if (menu instanceof HTMLElement) {
			const willOpen = menu.classList.contains('hidden')
			closePostMoreMenus(willOpen ? menu : null)
			menu.classList.toggle('hidden')
		}
		return true
	}

	const deleteButton = target.closest('button[data-delete]')
	if (deleteButton instanceof HTMLElement && deleteButton.dataset.delete) {
		const card = deleteButton.closest('.post-card')
		const parent = card?.parentElement
		const next = card?.nextSibling
		const postId = deleteButton.dataset.delete
		const purged = purgeFeedShownPost(state, postId)
		card?.remove()
		closePostMoreMenus()
		const entityHash = deleteButton.dataset.deleteEntity
			|| state.viewerEntityHash
		try {
			await runWrite('delete', () => socialApi('/posts', {
				method: 'DELETE',
				body: JSON.stringify({ postId, entityHash }),
			}))
		}
		catch {
			restoreFeedShownItems(state, purged)
			if (card && parent)
				parent.insertBefore(card, next)
		}
	}

	return false
}
