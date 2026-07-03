import { formatChatDmFromSocial } from '../../shared/runUri.mjs'
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
	if (target.closest('#saveMetaBtn')) {
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

	const followBtn = target.closest('[data-follow]')
	if (followBtn instanceof HTMLElement && followBtn.dataset.follow) {
		const entityHash = followBtn.dataset.follow
		const wasFollowing = followBtn.dataset.isFollowing === '1'
		await appContext.socialApi('/relationships/follow', {
			method: 'POST',
			body: JSON.stringify({ entityHash, follow: !wasFollowing, ...actingFields(appContext) }),
		})
		if (appContext.state.profileEntityHash === entityHash)
			await loadProfileFor(appContext, entityHash)
		else
			await loadExplore(appContext)
	}

	const blockBtn = target.closest('[data-block]')
	if (blockBtn instanceof HTMLElement && blockBtn.dataset.block) {
		await appContext.socialApi('/relationships/block', {
			method: 'POST',
			body: JSON.stringify({ entityHash: blockBtn.dataset.block, block: true, ...actingFields(appContext) }),
		})
		await refreshVisiblePosts(appContext)
		closePostMoreMenus()
	}

	const hideBtn = target.closest('[data-hide]')
	if (hideBtn instanceof HTMLElement && hideBtn.dataset.hide) {
		await appContext.socialApi('/relationships/hide', {
			method: 'POST',
			body: JSON.stringify({ entityHash: hideBtn.dataset.hide, hide: true, ...actingFields(appContext) }),
		})
		await refreshVisiblePosts(appContext)
		closePostMoreMenus()
	}

	const unblockBtn = target.closest('[data-unblock]')
	if (unblockBtn instanceof HTMLElement && unblockBtn.dataset.unblock) {
		await appContext.socialApi('/relationships/block', {
			method: 'POST',
			body: JSON.stringify({ entityHash: unblockBtn.dataset.unblock, block: false, ...actingFields(appContext) }),
		})
		await renderBlocklist(appContext, document.getElementById('blocklistSection'))
	}

	const unhideBtn = target.closest('[data-unhide]')
	if (unhideBtn instanceof HTMLElement && unhideBtn.dataset.unhide) {
		await appContext.socialApi('/relationships/hide', {
			method: 'POST',
			body: JSON.stringify({ entityHash: unhideBtn.dataset.unhide, hide: false, ...actingFields(appContext) }),
		})
		await renderBlocklist(appContext, document.getElementById('blocklistSection'))
	}

	const dmBtn = target.closest('[data-dm]')
	if (dmBtn instanceof HTMLElement && dmBtn.dataset.dm)
		window.location.href = formatChatDmFromSocial(dmBtn.dataset.dm)

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
