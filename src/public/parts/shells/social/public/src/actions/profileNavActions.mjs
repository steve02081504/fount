import { formatChatDmFromSocial } from '../../shared/runUri.mjs'
import { parseActionKey } from '../lib/actionKey.mjs'
import { runSocialWrite } from '../lib/socialWrite.mjs'
import { refreshVisiblePosts } from '../navigation.mjs'
import { loadExplore } from '../views/explore.mjs'
import { loadProfileFor, renderBlocklist } from '../views/profile.mjs'

import { closePostMoreMenus } from './shared.mjs'

/**
 * @param {object} appContext Social 应用上下文
 * @returns {Record<string, unknown>} 含 actingEntityHash 的请求体字段
 */
function actingFields(appContext) {
	const actingEntityHash = appContext.state.viewerEntityHash
	return actingEntityHash ? { actingEntityHash } : {}
}

/**
 * 处理个人资料、关注、拉黑与 Tab 切换相关点击。
 * @param {object} appContext Social 应用上下文
 * @param {HTMLElement} target 点击目标元素
 * @returns {Promise<void>}
 */
export async function handleProfileNavClick(appContext, target) {
	if (target.closest('#saveMetaButton')) {
		await appContext.socialApi('/profile/meta', {
			method: 'POST',
			body: JSON.stringify({
				exploreBlurb: document.getElementById('exploreBlurbInput')?.value ?? '',
				hideFromDiscovery: document.getElementById('exploreProtectedInput')?.checked ?? false,
				...actingFields(appContext),
			}),
		})
		if (appContext.state.profileEntityHash)
			await loadProfileFor(appContext, appContext.state.profileEntityHash)
	}

	const followButton = target.closest('[data-follow]')
	if (followButton instanceof HTMLElement && followButton.dataset.follow) {
		const entityHash = followButton.dataset.follow
		const wasFollowing = followButton.dataset.isFollowing === '1'
		const prevText = followButton.textContent
		followButton.textContent = appContext.geti18n(wasFollowing ? 'social.actions.follow' : 'social.actions.following')
		followButton.dataset.isFollowing = wasFollowing ? '0' : '1'
		try {
			await runSocialWrite('follow', () => appContext.socialApi('/relationships/follow', {
				method: 'POST',
				body: JSON.stringify({ entityHash, follow: !wasFollowing, ...actingFields(appContext) }),
			}))
			if (appContext.state.profileEntityHash === entityHash)
				await loadProfileFor(appContext, entityHash)
			else
				await loadExplore(appContext)
		}
		catch {
			followButton.textContent = prevText
			followButton.dataset.isFollowing = wasFollowing ? '1' : '0'
		}
	}

	const blockButton = target.closest('[data-block]')
	if (blockButton instanceof HTMLElement && blockButton.dataset.block) {
		await appContext.socialApi('/relationships/block', {
			method: 'POST',
			body: JSON.stringify({ entityHash: blockButton.dataset.block, block: true, ...actingFields(appContext) }),
		})
		await refreshVisiblePosts(appContext)
		closePostMoreMenus()
	}

	const hideButton = target.closest('[data-hide]')
	if (hideButton instanceof HTMLElement && hideButton.dataset.hide) {
		await appContext.socialApi('/relationships/hide', {
			method: 'POST',
			body: JSON.stringify({ entityHash: hideButton.dataset.hide, hide: true, ...actingFields(appContext) }),
		})
		await refreshVisiblePosts(appContext)
		closePostMoreMenus()
	}

	const muteButton = target.closest('[data-mute]')
	if (muteButton instanceof HTMLElement && muteButton.dataset.mute) {
		await appContext.socialApi('/relationships/mute', {
			method: 'POST',
			body: JSON.stringify({ entityHash: muteButton.dataset.mute, mute: true, ...actingFields(appContext) }),
		})
		await refreshVisiblePosts(appContext)
		closePostMoreMenus()
	}

	const reportButton = target.closest('[data-report]')
	if (reportButton instanceof HTMLElement && reportButton.dataset.report) {
		const parsed = parseActionKey(reportButton.dataset.report)
		if (parsed) {
			await appContext.socialApi('/governance/report', {
				method: 'POST',
				body: JSON.stringify({
					targetEntityHash: parsed.entityHash,
					targetPostId: parsed.postId,
					reason: 'user report',
					category: 'other',
					...actingFields(appContext),
				}),
			})
		}
		closePostMoreMenus()
	}

	const unblockButton = target.closest('[data-unblock]')
	if (unblockButton instanceof HTMLElement && unblockButton.dataset.unblock) {
		await appContext.socialApi('/relationships/block', {
			method: 'POST',
			body: JSON.stringify({ entityHash: unblockButton.dataset.unblock, block: false, ...actingFields(appContext) }),
		})
		await renderBlocklist(appContext, document.getElementById('blocklistSection'))
	}

	const unhideButton = target.closest('[data-unhide]')
	if (unhideButton instanceof HTMLElement && unhideButton.dataset.unhide) {
		await appContext.socialApi('/relationships/hide', {
			method: 'POST',
			body: JSON.stringify({ entityHash: unhideButton.dataset.unhide, hide: false, ...actingFields(appContext) }),
		})
		await renderBlocklist(appContext, document.getElementById('blocklistSection'))
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
