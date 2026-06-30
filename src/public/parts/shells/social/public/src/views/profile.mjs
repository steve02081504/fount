import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { entityHandle } from '../lib/display.mjs'
import { formatSocialProfileHref } from '/parts/shells:chat/src/lib/socialRunUri.mjs'

/**
 * 渲染拉黑列表 UI。
 * @param {object} appContext 应用上下文
 * @param {HTMLElement} container 容器
 * @returns {Promise<void>}
 */
export async function renderBlocklist(appContext, container) {
	const data = await appContext.socialApi('/profile/personal-lists')
	const blocked = data.blockedEntityHashes || []
	if (!blocked.length) {
		container.innerHTML = `<p class="hint">${escapeHtml(appContext.geti18n('social.blocklist.empty'))}</p>`
		return
	}
	container.innerHTML = `<h3 class="section-title">${escapeHtml(appContext.geti18n('social.blocklist.title'))}</h3>`
	for (const entityHash of blocked) {
		const row = document.createElement('div')
		row.className = 'blocklist-row'
		row.innerHTML = `
			<code class="entity-hash">${escapeHtml(entityHash)}</code>
			<button type="button" class="profile-action-btn" data-unblock="${escapeHtml(entityHash)}">${escapeHtml(appContext.geti18n('social.blocklist.unblock'))}</button>
		`
		container.appendChild(row)
	}
}

/**
 * 渲染资料页帖子列表（可选高亮指定帖）。
 * @param {object} appContext 应用上下文
 * @param {string} entityHash owner
 * @param {HTMLElement} container 容器
 * @param {string | null} [highlightPostId] 高亮帖
 * @returns {Promise<void>}
 */
export async function renderProfilePosts(appContext, entityHash, container, highlightPostId = null) {
	const data = await appContext.socialApi(`/profile/${entityHash}/posts`)
	container.replaceChildren()
	const items = data.items || []
	if (!items.length) {
		container.innerHTML = `<div class="empty">${escapeHtml(appContext.geti18n('social.empty.profilePosts'))}</div>`
		return
	}
	for (const item of items) {
		const card = await appContext.buildPostCard(item)
		if (highlightPostId && card.dataset.postId === highlightPostId)
			card.classList.add('highlight-post')
		container.appendChild(card)
	}
	if (highlightPostId)
		container.querySelector(`[data-post-id="${highlightPostId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/**
 * 渲染资料页点赞列表。
 * @param {object} appContext 应用上下文
 * @param {string} entityHash owner
 * @param {HTMLElement} container 容器
 * @returns {Promise<void>}
 */
export async function renderProfileLikes(appContext, entityHash, container) {
	const data = await appContext.socialApi(`/profile/${entityHash}/likes`)
	container.replaceChildren()
	const items = data.items || []
	if (!items.length) {
		container.innerHTML = `<div class="empty">${escapeHtml(appContext.geti18n('social.empty.likedPosts'))}</div>`
		return
	}
	for (const item of items)
		container.appendChild(await appContext.buildPostCard(item))
}

/**
 * 渲染资料页 following 列表。
 * @param {object} appContext 应用上下文
 * @param {string} entityHash owner
 * @param {HTMLElement} container 容器
 * @returns {Promise<void>}
 */
export async function renderProfileFollowingList(appContext, entityHash, container) {
	const data = await appContext.socialApi(`/profile/${entityHash}/following`)
	const following = data.following || []
	container.replaceChildren()
	if (!following.length) {
		container.innerHTML = `<div class="empty">${escapeHtml(appContext.geti18n('social.empty.following'))}</div>`
		return
	}
	for (const hash of following) {
		const link = document.createElement('a')
		link.className = 'following-link'
		link.href = formatSocialProfileHref(hash)
		link.innerHTML = `
			${appContext.renderAvatarHtml(hash, null)}
			<span>
				<strong>${escapeHtml(appContext.authorLabel(hash))}</strong>
				<span class="profile-handle">${escapeHtml(entityHandle(hash))}</span>
			</span>
		`
		container.appendChild(link)
	}
}

/**
 * 刷新当前资料页帖子列表。
 * @param {object} appContext 应用上下文
 * @param {string | null} [highlightPostId] 高亮帖
 * @returns {Promise<void>}
 */
export async function refreshProfilePosts(appContext, highlightPostId = null) {
	if (!appContext.state.profileEntityHash) return
	const panel = document.getElementById('profilePostsPanel')
	if (panel)
		await renderProfilePosts(appContext, appContext.state.profileEntityHash, panel, highlightPostId)
}

/**
 * 加载并渲染指定 entity 的资料页。
 * @param {object} appContext 应用上下文
 * @param {string} entityHash owner
 * @param {string | null} [highlightPostId] 高亮帖
 * @returns {Promise<void>}
 */
export async function loadProfileFor(appContext, entityHash, highlightPostId = null) {
	appContext.state.profileEntityHash = entityHash
	const [data, followingData] = await Promise.all([
		appContext.socialApi(`/profile/${entityHash}`),
		appContext.socialApi(`/profile/${entityHash}/following`).catch(() => ({ following: [] })),
	])
	const isSelf = appContext.state.viewerEntityHash && entityHash === appContext.state.viewerEntityHash
	const container = document.getElementById('profileView')
	const name = data.profile?.name || appContext.authorLabel(entityHash)
	const handle = entityHandle(entityHash)
	const followingCount = (followingData.following || []).length

	container.innerHTML = `
		<div class="profile-banner"></div>
		<div class="profile-header">
			<div class="profile-header-actions">
				${isSelf ? `
					<a class="profile-action-btn" href="/parts/shells:chat/profile/">${escapeHtml(appContext.geti18n('social.profile.editInChat'))}</a>
				` : `
					<button type="button" class="profile-action-btn primary" data-follow="${escapeHtml(entityHash)}" data-is-following="${data.isFollowing ? '1' : '0'}">${escapeHtml(data.isFollowing ? appContext.geti18n('social.actions.following') : appContext.geti18n('social.actions.follow'))}</button>
					<button type="button" class="profile-action-btn" data-dm="${escapeHtml(entityHash)}">${escapeHtml(appContext.geti18n('social.actions.dm'))}</button>
				`}
			</div>
			<div class="profile-header-row">
				${appContext.renderAvatarHtml(entityHash, data.profile, 'profile-avatar')}
				<h2>${escapeHtml(name)}</h2>
				<span class="profile-handle">${escapeHtml(handle)}</span>
				${data.profile?.bio ? `<p class="profile-bio">${escapeHtml(data.profile.bio)}</p>` : ''}
				<div class="profile-stats">
					<span class="profile-stat"><strong>${data.postCount || 0}</strong> <span>${escapeHtml(appContext.geti18n('social.profile.statsPosts'))}</span></span>
					<span class="profile-stat"><strong>${followingCount}</strong> <span>${escapeHtml(appContext.geti18n('social.profile.statsFollowing'))}</span></span>
				</div>
			</div>
			<div class="profile-tabs tabs tabs-bordered">
				<button type="button" class="profile-tab tab tab-active active" data-profile-tab="posts">${escapeHtml(appContext.geti18n('social.profile.tabPosts'))}</button>
				<button type="button" class="profile-tab tab" data-profile-tab="likes">${escapeHtml(appContext.geti18n('social.profile.tabLikes'))}</button>
				<button type="button" class="profile-tab tab" data-profile-tab="following">${escapeHtml(appContext.geti18n('social.profile.tabFollowing'))}</button>
			</div>
		</div>
		<div id="profilePostsPanel" class="profile-tab-panel" data-profile-panel="posts"></div>
		<div id="profileLikesPanel" class="profile-tab-panel hidden" data-profile-panel="likes"></div>
		<div id="profileFollowingPanel" class="profile-tab-panel hidden" data-profile-panel="following"></div>
		${isSelf ? `
			<div class="profile-settings card">
				<h3>${escapeHtml(appContext.geti18n('social.profile.exploreSettings'))}</h3>
				<textarea id="exploreBlurbInput" rows="3">${escapeHtml(data.socialMeta?.exploreBlurb || '')}</textarea>
				<label><input type="checkbox" id="exploreProtectedInput" ${data.socialMeta?.isProtected ? 'checked' : ''} /> ${escapeHtml(appContext.geti18n('social.profile.hideFromExplore'))}</label>
				<button type="button" id="saveMetaBtn" class="profile-action-btn primary">${escapeHtml(appContext.geti18n('social.profile.saveExplore'))}</button>
			</div>
			<div id="blocklistSection" class="profile-settings card"></div>
		` : ''}
	`

	if (isSelf)
		await renderBlocklist(appContext, document.getElementById('blocklistSection'))

	await renderProfilePosts(appContext, entityHash, document.getElementById('profilePostsPanel'), highlightPostId)
	await renderProfileLikes(appContext, entityHash, document.getElementById('profileLikesPanel'))
	await renderProfileFollowingList(appContext, entityHash, document.getElementById('profileFollowingPanel'))
}

/**
 * 加载当前观看者自身资料页。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function loadProfile(appContext) {
	const viewer = await appContext.socialApi('/viewer')
	appContext.state.viewerEntityHash = viewer.viewerEntityHash
	if (!appContext.state.viewerEntityHash) {
		document.getElementById('profileView').innerHTML = `<div class="empty">${escapeHtml(appContext.geti18n('social.empty.noIdentity'))}</div>`
		return
	}
	await loadProfileFor(appContext, appContext.state.viewerEntityHash)
}

/**
 * 提交对指定帖子的公开回复。
 * @param {object} appContext 应用上下文
 * @param {string} entityHash 目标
 * @param {string} postId 帖子
 * @param {string} text 回复
 * @returns {Promise<void>}
 */
export async function submitReply(appContext, entityHash, postId, text) {
	await appContext.socialApi('/profile/post', {
		method: 'POST',
		body: JSON.stringify({
			text,
			replyTo: { entityHash, postId },
			visibility: 'public',
			lang: document.getElementById('postLang')?.value.trim() || 'zh-CN',
		}),
	})
}
