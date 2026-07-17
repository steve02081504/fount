import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { aliasForEntity, setEntityAlias } from '/parts/shells:chat/shared/aliases.mjs'
import { setCared } from '/parts/shells:chat/shared/care.mjs'
import { formatChatDmFromSocial } from '../../shared/runUri.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import { promptText } from '../lib/dialog.mjs'
import {
	purgeFeedShownAuthor,
	removePostsByAuthor,
	restoreFeedShownItems,
	restoreRemovedPosts,
	runSocialWrite,
} from '../lib/socialWrite.mjs'
import { socialState } from '../state.mjs'
import { loadExplore } from '../views/explore.mjs'
import {
	activateProfileTab,
	loadProfileFor,
	openProfileRelationshipList,
	openProfileSettingsDialog,
	renderBlocklist,
} from '../views/profile.mjs'

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
	if (target.closest('[data-profile-edit]')) {
		window.location.href = '/parts/shells:chat/profile/'
		return
	}

	if (target.closest('[data-profile-settings]')) {
		await openProfileSettingsDialog(socialState.profileSocialMeta || {})
		return
	}

	const settingsBack = target.closest('#settingsView [data-view="profile"]')
	if (settingsBack) {
		const { switchView } = await import('../navigation.mjs')
		await switchView('profile')
		return
	}

	const exploreShortcut = target.closest('.explore-shortcuts [data-view]')
	if (exploreShortcut instanceof HTMLElement && exploreShortcut.dataset.view) {
		const { switchView } = await import('../navigation.mjs')
		await switchView(exploreShortcut.dataset.view)
		return
	}

	const statButton = target.closest('[data-profile-stat]')
	if (statButton instanceof HTMLElement && statButton.dataset.profileStat) {
		const kind = statButton.dataset.profileStat
		const entityHash = statButton.dataset.entityHash || socialState.profileEntityHash
		if (kind === 'posts') {
			await activateProfileTab('posts')
			document.getElementById('profilePostsPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
			return
		}
		if ((kind === 'following' || kind === 'followers') && entityHash) {
			await openProfileRelationshipList(entityHash, kind)
			return
		}
	}

	const followButton = target.closest('[data-follow]')
	if (followButton instanceof HTMLElement && followButton.dataset.follow) {
		const entityHash = followButton.dataset.follow
		const wasFollowing = followButton.dataset.isFollowing === '1'
		const prevKey = followButton.dataset.i18n
		followButton.dataset.i18n = wasFollowing ? 'social.actions.follow' : 'social.actions.following'
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
			followButton.dataset.i18n = prevKey
			followButton.dataset.isFollowing = wasFollowing ? '1' : '0'
		}
	}

	const careButton = target.closest('[data-care]')
	if (careButton instanceof HTMLElement && careButton.dataset.care) {
		const entityHash = careButton.dataset.care
		const owner = socialState.viewerEntityHash
		if (!owner) return
		const wasCared = careButton.dataset.isCared === '1'
		const prevKey = careButton.dataset.i18n
		careButton.dataset.i18n = wasCared ? 'social.actions.care' : 'social.actions.careRemove'
		careButton.dataset.isCared = wasCared ? '0' : '1'
		try {
			await setCared(owner, entityHash, !wasCared)
			showToastI18n('success', wasCared ? 'social.actions.careRemoved' : 'social.actions.careAdded')
		}
		catch {
			careButton.dataset.i18n = prevKey
			careButton.dataset.isCared = wasCared ? '1' : '0'
		}
	}

	const aliasButton = target.closest('[data-set-alias]')
	if (aliasButton instanceof HTMLElement && aliasButton.dataset.setAlias) {
		const entityHash = aliasButton.dataset.setAlias
		const next = await promptText(geti18n('social.actions.setAliasPrompt'), aliasForEntity(entityHash) || '')
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
		const section = document.getElementById('blocklistSection')
		if (section) await renderBlocklist(section)
	}

	const unhideButton = target.closest('[data-unhide]')
	if (unhideButton instanceof HTMLElement && unhideButton.dataset.unhide) {
		await socialApi('/relationships/hide', {
			method: 'POST',
			body: JSON.stringify({ entityHash: unhideButton.dataset.unhide, hide: false }),
		})
		const section = document.getElementById('blocklistSection')
		if (section) await renderBlocklist(section)
	}

	const dmButton = target.closest('[data-dm]')
	if (dmButton instanceof HTMLElement && dmButton.dataset.dm)
		window.location.href = formatChatDmFromSocial(dmButton.dataset.dm)

	const profileTab = target.closest('[data-profile-tab]')
	if (profileTab instanceof HTMLElement && profileTab.dataset.profileTab)
		await activateProfileTab(profileTab.dataset.profileTab)

	const albumChip = target.closest('[data-album-open][data-album-id]')
	if (albumChip instanceof HTMLElement && albumChip.dataset.albumOpen && albumChip.dataset.albumId) {
		const { openAlbumDetail } = await import('../views/albums.mjs')
		const { switchView } = await import('../navigation.mjs')
		await switchView('profile')
		await activateProfileTab('albums', { force: true })
		const panel = document.getElementById('profileAlbumsPanel')
		if (panel)
			await openAlbumDetail(albumChip.dataset.albumOpen, albumChip.dataset.albumId, panel)
	}
}
