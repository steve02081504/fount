import { formatSocialProfileHref } from '../lib/runUri.mjs'

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
		container.innerHTML = `<p class="hint">${appContext.geti18n('social.blocklist.empty')}</p>`
		return
	}
	container.innerHTML = `<h2 class="section-title">${appContext.geti18n('social.blocklist.title')}</h2>`
	for (const entityHash of blocked) {
		const row = document.createElement('div')
		row.className = 'card blocklist-row'
		row.innerHTML = `
			<code class="entity-hash">${entityHash}</code>
			<button type="button" class="link-btn" data-unblock="${entityHash}">${appContext.geti18n('social.blocklist.unblock')}</button>
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
	container.querySelector('.profile-posts')?.remove()
	const data = await appContext.socialApi(`/profile/${entityHash}/posts`)
	const list = document.createElement('div')
	list.className = 'profile-posts'
	list.innerHTML = `<h2 class="section-title">${appContext.geti18n('social.profile.viewPosts')}</h2>`
	const itemsContainer = document.createElement('div')
	list.appendChild(itemsContainer)
	const items = data.items || []
	if (!items.length)
		itemsContainer.innerHTML = `<div class="empty">${appContext.geti18n('social.empty.profilePosts')}</div>`
	else
		for (const item of items) {
			const card = await appContext.buildPostCard(item)
			if (highlightPostId && card.dataset.postId === highlightPostId)
				card.classList.add('highlight-post')
			itemsContainer.appendChild(card)
		}
	container.appendChild(list)
	if (highlightPostId)
		list.querySelector(`[data-post-id="${highlightPostId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/**
 * 刷新当前资料页帖子列表。
 * @param {object} appContext 应用上下文
 * @param {string | null} [highlightPostId] 高亮帖
 * @returns {Promise<void>}
 */
export async function refreshProfilePosts(appContext, highlightPostId = null) {
	if (!appContext.state.profileEntityHash) return
	await renderProfilePosts(
		appContext,
		appContext.state.profileEntityHash,
		document.getElementById('profileView'),
		highlightPostId,
	)
}

/**
 * 渲染资料页 following 链接列表。
 * @param {object} appContext 应用上下文
 * @param {string} entityHash owner
 * @param {HTMLElement} container 容器
 * @returns {Promise<void>}
 */
export async function renderProfileFollowing(appContext, entityHash, container) {
	const data = await appContext.socialApi(`/profile/${entityHash}/following`)
	const following = data.following || []
	if (!following.length) return
	const section = document.createElement('div')
	section.className = 'card profile-following'
	section.innerHTML = `<h2 class="section-title">${appContext.geti18n('social.profile.following')}</h2>`
	const links = document.createElement('div')
	for (const hash of following) {
		const link = document.createElement('a')
		link.className = 'link-btn following-link'
		link.href = formatSocialProfileHref(hash)
		link.textContent = appContext.authorLabel(hash)
		links.appendChild(link)
	}
	section.appendChild(links)
	const postsSection = container.querySelector('.profile-posts')
	if (postsSection)
		container.insertBefore(section, postsSection)
	else
		container.appendChild(section)
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
	const data = await appContext.socialApi(`/profile/${entityHash}`)
	const isSelf = appContext.state.viewerEntityHash && entityHash === appContext.state.viewerEntityHash
	const container = document.getElementById('profileView')
	const name = data.profile?.name || appContext.authorLabel(entityHash)
	container.innerHTML = `
		<div class="card profile-card">
			<div class="profile-header-row">
				${appContext.renderAvatarHtml(entityHash, data.profile, 'profile-avatar')}
				<div>
					<h2>${name}</h2>
					<p>${data.profile?.bio || ''}</p>
					<p class="post-meta">${appContext.geti18n('social.profile.postCount', { n: data.postCount || 0 })}</p>
					<p><code class="entity-hash">${entityHash}</code></p>
				</div>
			</div>
			${isSelf ? `
				<p class="hint">${appContext.geti18n('social.identityNote')}</p>
				<p class="hint">${appContext.geti18n('social.mentionHint')}</p>
				<a class="link-btn" href="/parts/shells:chat/profile/">${appContext.geti18n('social.profile.editInChat')}</a>
			` : `
				<button type="button" class="link-btn" data-follow="${entityHash}" data-is-following="${data.isFollowing ? '1' : '0'}">${data.isFollowing ? appContext.geti18n('social.actions.following') : appContext.geti18n('social.actions.follow')}</button>
				<button type="button" class="link-btn" data-dm="${entityHash}">${appContext.geti18n('social.actions.dm')}</button>
			`}
		</div>
		${isSelf ? `
			<div class="card profile-settings">
				<h3>${appContext.geti18n('social.profile.exploreSettings')}</h3>
				<textarea id="exploreBlurbInput" rows="3">${data.socialMeta?.exploreBlurb || ''}</textarea>
				<label><input type="checkbox" id="exploreProtectedInput" ${data.socialMeta?.isProtected ? 'checked' : ''} /> ${appContext.geti18n('social.profile.hideFromExplore')}</label>
				<button type="button" id="saveMetaBtn" class="link-btn">${appContext.geti18n('social.profile.saveExplore')}</button>
			</div>
		` : ''}
		<div id="blocklistSection" class="blocklist-section"></div>
	`
	if (isSelf)
		await renderBlocklist(appContext, document.getElementById('blocklistSection'))
	await renderProfileFollowing(appContext, entityHash, container)
	await renderProfilePosts(appContext, entityHash, container, highlightPostId)
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
		document.getElementById('profileView').innerHTML = `<div class="empty card">${appContext.geti18n('social.empty.noIdentity')}</div>`
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
			lang: document.getElementById('postLang').value.trim() || 'zh-CN',
		}),
	})
}
