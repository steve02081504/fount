import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { aliasForEntity, setEntityAlias } from '/parts/shells:chat/shared/aliases.mjs'
import { setCared } from '/parts/shells:chat/shared/care.mjs'
import { formatChatDmFromSocial } from '../../shared/runUri.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import {
	purgeFeedShownAuthor,
	removePostsByAuthor,
	restoreFeedShownItems,
	restoreRemovedPosts,
	runSocialWrite,
} from '../lib/socialWrite.mjs'
import { socialState } from '../state.mjs'
import { loadExplore } from '../views/explore.mjs'
import { loadProfileFor, renderBlocklist } from '../views/profile.mjs'

import { closePostMoreMenus } from './shared.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

/**
 * 乐观隐藏作者帖子，失败回滚。
 * @param {string} entityHash 作者
 * @param {() => Promise<void>} write 写请求
 * @param {string} failKey i18n 失败键
 * @returns {Promise<void>}
 */
async function optimisticAuthorFilter(entityHash, write, failKey) {
	const purged = purgeFeedShownAuthor(socialState, entityHash)
	const removed = removePostsByAuthor(entityHash)
	closePostMoreMenus()
	try {
		await runSocialWrite(failKey, write)
	}
	catch {
		restoreFeedShownItems(socialState, purged)
		restoreRemovedPosts(removed)
	}
}

/**
 * 处理个人资料、关注、拉黑与 Tab 切换相关点击。
 * @param {HTMLElement} target 点击目标元素
 * @returns {Promise<void>}
 */
export async function handleProfileNavClick(target) {
	if (target.closest('#saveMetaButton')) {
		await socialApi('/profile/meta', {
			method: 'POST',
			body: JSON.stringify({
				exploreBlurb: document.getElementById('exploreBlurbInput')?.value ?? '',
				hideFromDiscovery: document.getElementById('exploreProtectedInput')?.checked ?? false,
			}),
		})
		if (socialState.profileEntityHash)
			await loadProfileFor(socialState.profileEntityHash)
	}

	const followButton = target.closest('[data-follow]')
	if (followButton instanceof HTMLElement && followButton.dataset.follow) {
		const entityHash = followButton.dataset.follow
		const wasFollowing = followButton.dataset.isFollowing === '1'
		const prevText = followButton.textContent
		followButton.textContent = geti18n(wasFollowing ? 'social.actions.follow' : 'social.actions.following')
		followButton.dataset.isFollowing = wasFollowing ? '0' : '1'
		try {
			await runSocialWrite('follow', () => socialApi('/relationships/follow', {
				method: 'POST',
				body: JSON.stringify({ entityHash, follow: !wasFollowing }),
			}))
			if (socialState.profileEntityHash === entityHash)
				await loadProfileFor(entityHash)
			else
				await loadExplore()
		}
		catch {
			followButton.textContent = prevText
			followButton.dataset.isFollowing = wasFollowing ? '1' : '0'
		}
	}

	const careButton = target.closest('[data-care]')
	if (careButton instanceof HTMLElement && careButton.dataset.care) {
		const entityHash = careButton.dataset.care
		const owner = socialState.viewerEntityHash
		if (!owner) return
		const wasCared = careButton.dataset.isCared === '1'
		const prevText = careButton.textContent
		careButton.textContent = geti18n(wasCared ? 'social.actions.care' : 'social.actions.careRemove')
		careButton.dataset.isCared = wasCared ? '0' : '1'
		try {
			await setCared(owner, entityHash, !wasCared)
			showToastI18n('success', wasCared ? 'social.actions.careRemoved' : 'social.actions.careAdded')
		}
		catch {
			careButton.textContent = prevText
			careButton.dataset.isCared = wasCared ? '1' : '0'
		}
	}

	const aliasButton = target.closest('[data-set-alias]')
	if (aliasButton instanceof HTMLElement && aliasButton.dataset.setAlias) {
		const entityHash = aliasButton.dataset.setAlias
		const next = prompt(geti18n('social.actions.setAliasPrompt'), aliasForEntity(entityHash))
		if (next != null) {
			await setEntityAlias(entityHash, next)
			showToastI18n('success', 'social.actions.aliasSaved')
			if (socialState.profileEntityHash === entityHash)
				await loadProfileFor(entityHash)
		}
	}

	const blockButton = target.closest('[data-block]')
	if (blockButton instanceof HTMLElement && blockButton.dataset.block) {
		const entityHash = blockButton.dataset.block
		await optimisticAuthorFilter(entityHash, () => socialApi('/relationships/block', {
			method: 'POST',
			body: JSON.stringify({ entityHash, block: true }),
		}), 'block')
	}

	const hideButton = target.closest('[data-hide]')
	if (hideButton instanceof HTMLElement && hideButton.dataset.hide) {
		const entityHash = hideButton.dataset.hide
		await optimisticAuthorFilter(entityHash, () => socialApi('/relationships/hide', {
			method: 'POST',
			body: JSON.stringify({ entityHash, hide: true }),
		}), 'hide')
	}

	const muteButton = target.closest('[data-mute]')
	if (muteButton instanceof HTMLElement && muteButton.dataset.mute) {
		const entityHash = muteButton.dataset.mute
		await optimisticAuthorFilter(entityHash, () => socialApi('/relationships/mute', {
			method: 'POST',
			body: JSON.stringify({ entityHash, mute: true }),
		}), 'mute')
	}

	const unblockButton = target.closest('[data-unblock]')
	if (unblockButton instanceof HTMLElement && unblockButton.dataset.unblock) {
		await socialApi('/relationships/block', {
			method: 'POST',
			body: JSON.stringify({ entityHash: unblockButton.dataset.unblock, block: false }),
		})
		await renderBlocklist(document.getElementById('blocklistSection'))
	}

	const unhideButton = target.closest('[data-unhide]')
	if (unhideButton instanceof HTMLElement && unhideButton.dataset.unhide) {
		await socialApi('/relationships/hide', {
			method: 'POST',
			body: JSON.stringify({ entityHash: unhideButton.dataset.unhide, hide: false }),
		})
		await renderBlocklist(document.getElementById('blocklistSection'))
	}

	const dmButton = target.closest('[data-dm]')
	if (dmButton instanceof HTMLElement && dmButton.dataset.dm)
		window.location.href = formatChatDmFromSocial(dmButton.dataset.dm)

	const profileTab = target.closest('[data-profile-tab]')
	if (profileTab instanceof HTMLElement && profileTab.dataset.profileTab) {
		const tab = profileTab.dataset.profileTab
		for (const button of document.querySelectorAll('[data-profile-tab]')) {
			button.classList.toggle('active', button.dataset.profileTab === tab)
			button.classList.toggle('tab-active', button.dataset.profileTab === tab)
		}
		for (const panel of document.querySelectorAll('[data-profile-panel]'))
			panel.classList.toggle('hidden', panel.dataset.profilePanel !== tab)
	}
}
