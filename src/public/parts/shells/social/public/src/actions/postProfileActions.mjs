import { formatSocialShareHttpsUrl } from '../../shared/protocolUrl.mjs'
import { addPostNote, deletePost, editPost, getPost, getPostNotes, votePostNote } from '../endpoints/posts.mjs'
import { downloadPostHtml } from '../exportHtml.mjs'
import { parseActionKey } from '../lib/actionKey.mjs'
import { promptText, promptTextArea, showText } from '../lib/dialog.mjs'
import { handlePollVoteClick } from '../lib/pollUi.mjs'
import {
	purgeFeedShownPost,
	removePostsById,
	restoreFeedShownItems,
	restoreRemovedPosts,
	runWrite,
} from '../lib/socialWrite.mjs'
import { refreshVisiblePosts } from '../navigation.mjs'
import { state } from '../state.mjs'

import { closePostMoreMenus, copyTextToClipboard, flashCopiedLabel, shareOrCopyPostLink } from './shared.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'

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
			const next = await promptText('social.post.editPrompt', current)
			if (next == null || next === current) return true
			await runWrite('edit', () => editPost(parsed.entityHash, parsed.postId, next))
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
			try {
				const { item } = await getPost(author, postId)
				const revisions = item?.post?.revisions || []
				const lines = revisions.map((rev, index) => `#${index + 1} ${rev.text || ''}`).join('\n---\n')
				await showText(lines || geti18n('social.post.editHistoryEmpty'), 'social.post.editHistory')
			}
			catch (error) {
				handleError('social.post.loadFailed', {}, error)
			}
		}
		return true
	}

	const addNoteButton = target.closest('[data-add-note]')
	if (addNoteButton instanceof HTMLElement && addNoteButton.dataset.addNote) {
		const parsed = parseActionKey(addNoteButton.dataset.addNote)
		if (parsed) {
			closePostMoreMenus()
			const text = await promptTextArea('social.notes.prompt')
			if (!text?.trim()) return true
			await runWrite('addNote', () => addPostNote(parsed.entityHash, parsed.postId, text.trim()))
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
			await runWrite('noteVote', () => votePostNote(parsed.entityHash, parsed.postId, noteId, helpful))
			await refreshVisiblePosts()
		}
		return true
	}

	const noteMoreButton = target.closest('[data-note-more]')
	if (noteMoreButton instanceof HTMLElement && noteMoreButton.dataset.noteMore) {
		const parsed = parseActionKey(noteMoreButton.dataset.noteMore)
		if (parsed) 
			try {
				const data = await getPostNotes(parsed.entityHash, parsed.postId)
				await showText((data.notes || []).map(note =>
					`[${note.score >= 0 ? '+' : ''}${note.score}] ${note.text || ''}`).join('\n---\n')
					|| geti18n('social.notes.empty'), 'social.notes.listTitle')
			}
			catch (error) {
				handleError('social.post.loadFailed', {}, error)
				return true
			}
		
		return true
	}

	const copyLinkButton = target.closest('[data-copy-link]')
	if (copyLinkButton instanceof HTMLElement && copyLinkButton.dataset.copyLink) {
		const parsed = parseActionKey(copyLinkButton.dataset.copyLink)
		if (parsed) {
			const { entityHash, postId } = parsed
			await copyTextToClipboard(formatSocialShareHttpsUrl(entityHash, postId))
			flashCopiedLabel(copyLinkButton.querySelector('[data-i18n="social.actions.copyLink"]'), 'social.actions.copyLink')
			closePostMoreMenus()
		}
		return true
	}

	const downloadHtmlButton = target.closest('[data-download-html]')
	if (downloadHtmlButton instanceof HTMLElement && downloadHtmlButton.dataset.downloadHtml) {
		const parsed = parseActionKey(downloadHtmlButton.dataset.downloadHtml)
		if (parsed) {
			closePostMoreMenus()
			let content
			try {
				content = (await getPost(parsed.entityHash, parsed.postId)).item.post.content
			}
			catch (error) {
				handleError('social.post.loadFailed', {}, error)
				return true
			}
			try {
				await downloadPostHtml(content)
			}
			catch {
				/* 媒体失败已在 exportHtml 内 handleError */
			}
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
					|| shareButton.querySelector('.sr-only'),
					'social.actions.share',
				)
			closePostMoreMenus()
		}
		return true
	}

	const deleteButton = target.closest('button[data-delete]')
	if (deleteButton instanceof HTMLElement && deleteButton.dataset.delete) {
		const postId = deleteButton.dataset.delete
		const purged = purgeFeedShownPost(state, postId)
		state.suppressedFeedPostIds.add(postId)
		// 清掉所有同 id 卡片（含 WS/loadFeed 竞态留下的重复），并记下原位置以便回滚
		const removed = removePostsById(postId)
		closePostMoreMenus()
		const entityHash = deleteButton.dataset.deleteEntity
			|| state.viewerEntityHash
		try {
			await runWrite('delete', () => deletePost(postId, entityHash))
		}
		catch {
			state.suppressedFeedPostIds.delete(postId)
			restoreFeedShownItems(state, purged)
			restoreRemovedPosts(removed)
		}
		return true
	}

	return false
}
