import { formatSocialProfileRunUri } from '../../shared/runUri.mjs'
import { parseActionKey } from '../lib/actionKey.mjs'
import { formatSocialProfileHref } from '/parts/shells:chat/shared/socialRunUri.mjs'
import { refreshVisiblePosts } from '../navigation.mjs'

import { closePostMoreMenus, copyTextToClipboard } from './shared.mjs'

/**
 * @param {object} appContext Social 应用上下文
 * @param {HTMLElement} target 点击目标元素
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handlePostProfileActionsClick(appContext, target) {
	const copyLinkBtn = target.closest('[data-copy-link]')
	if (copyLinkBtn instanceof HTMLElement && copyLinkBtn.dataset.copyLink) {
		const parsed = parseActionKey(copyLinkBtn.dataset.copyLink)
		if (parsed) {
			const { entityHash, postId } = parsed
			const runUri = formatSocialProfileRunUri(entityHash, postId)
			const pageUrl = `${window.location.origin}${formatSocialProfileHref(entityHash, postId)}`
			await copyTextToClipboard(`${runUri}\n${pageUrl}`)
			const label = copyLinkBtn.querySelector('[data-i18n="social.actions.copyLink"]')
			if (label) label.textContent = appContext.geti18n('social.actions.copied')
			setTimeout(() => {
				if (label) label.textContent = appContext.geti18n('social.actions.copyLink')
			}, 1500)
			closePostMoreMenus()
		}
	}

	const moreToggle = target.closest('[data-more-toggle]')
	if (moreToggle instanceof HTMLElement && moreToggle.dataset.moreToggle) {
		const menu = document.querySelector(`[data-more-menu="${moreToggle.dataset.moreToggle}"]`)
		if (menu instanceof HTMLElement) {
			const willOpen = menu.classList.contains('hidden')
			closePostMoreMenus(willOpen ? menu : null)
			menu.classList.toggle('hidden')
		}
		return true
	}

	const deleteBtn = target.closest('button[data-delete]')
	if (deleteBtn instanceof HTMLElement && deleteBtn.dataset.delete) {
		await appContext.socialApi('/posts', {
			method: 'DELETE',
			body: JSON.stringify({ postId: deleteBtn.dataset.delete }),
		})
		await refreshVisiblePosts(appContext)
		closePostMoreMenus()
	}

	return false
}
