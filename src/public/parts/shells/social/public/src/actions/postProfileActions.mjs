import { formatSocialProfileRunUri } from '../../shared/runUri.mjs'
import { parseActionKey } from '../lib/actionKey.mjs'
import { handlePollVoteClick } from '../lib/pollUi.mjs'
import { runSocialWrite } from '../lib/socialWrite.mjs'
import { refreshVisiblePosts } from '../navigation.mjs'
import { formatSocialProfileHref } from '/parts/shells:chat/shared/socialRunUri.mjs'

import { closePostMoreMenus, copyTextToClipboard } from './shared.mjs'

/**
 * @param {object} appContext Social 应用上下文
 * @param {HTMLElement} target 点击目标元素
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handlePostProfileActionsClick(appContext, target) {
	if (await handlePollVoteClick(appContext, target)) return true

	const editButton = target.closest('[data-edit]')
	if (editButton instanceof HTMLElement && editButton.dataset.edit) {
		const parsed = parseActionKey(editButton.dataset.edit)
		if (parsed) {
			closePostMoreMenus()
			const card = editButton.closest('.post-card')
			const current = decodeURIComponent(card?.dataset.postText || '')
			const next = window.prompt(appContext.geti18n('social.post.editPrompt'), current)
			if (next == null || next === current) return true
			await runSocialWrite('edit', () => appContext.socialApi(
				`/posts/${encodeURIComponent(parsed.entityHash)}/${encodeURIComponent(parsed.postId)}/edit`,
				{ method: 'POST', body: JSON.stringify({ text: next }) },
			))
			await refreshVisiblePosts(appContext)
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
			void appContext.socialApi(`/profile/${encodeURIComponent(author)}/posts?limit=50`).then(async data => {
				const item = (data.items || []).find(row => row.postId === postId)
				const revisions = item?.post?.revisions || []
				const lines = revisions.map((rev, idx) => `#${idx + 1} ${rev.text || ''}`).join('\n---\n')
				window.alert(lines || appContext.geti18n('social.post.editHistoryEmpty'))
			})
		}
		return true
	}

	const copyLinkButton = target.closest('[data-copy-link]')
	if (copyLinkButton instanceof HTMLElement && copyLinkButton.dataset.copyLink) {
		const parsed = parseActionKey(copyLinkButton.dataset.copyLink)
		if (parsed) {
			const { entityHash, postId } = parsed
			const runUri = formatSocialProfileRunUri(entityHash, postId)
			const pageUrl = `${window.location.origin}${formatSocialProfileHref(entityHash, postId)}`
			await copyTextToClipboard(`${runUri}\n${pageUrl}`)
			const label = copyLinkButton.querySelector('[data-i18n="social.actions.copyLink"]')
			if (label) label.textContent = appContext.geti18n('social.actions.copied')
			setTimeout(() => {
				if (label) label.textContent = appContext.geti18n('social.actions.copyLink')
			}, 1500)
			closePostMoreMenus()
		}
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
		card?.remove()
		closePostMoreMenus()
		const postId = deleteButton.dataset.delete
		const entityHash = deleteButton.dataset.deleteEntity
			|| appContext.state.viewerEntityHash
		try {
			await runSocialWrite('delete', () => appContext.socialApi('/posts', {
				method: 'DELETE',
				body: JSON.stringify({ postId, entityHash }),
			}))
		}
		catch {
			if (card && parent)
				parent.insertBefore(card, next)
		}
	}

	return false
}
