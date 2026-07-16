import { formatSocialProfileHref } from '../../shared/runUri.mjs'
import { socialApi, viewerEntityHash } from '../lib/apiClient.mjs'
import { authorLabel, entityHandle, renderAvatarHtml } from '../lib/display.mjs'
import { bindInfiniteScroll, disconnectInfiniteScroll, ensureScrollSentinel } from '/scripts/infiniteScroll.mjs'
import { renderTemplate, renderTemplateAsHtmlString } from '/scripts/features/template.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { isCared } from '/parts/shells:chat/shared/care.mjs'
import { buildPostCard } from '../postCard.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { socialState } from '../state.mjs'

/**
 * 渲染拉黑/隐藏列表 UI。
 * @param {HTMLElement} container 容器
 * @returns {Promise<void>}
 */
export async function renderBlocklist(container) {
	const data = await socialApi('/profile/personal-lists')
	const entries = data.entries || []
	const blocked = entries.filter(entry => entry.kind === 'block')
	const hidden = entries.filter(entry => entry.kind === 'hide')
	if (!blocked.length && !hidden.length) {
		container.innerHTML = `<p class="hint">${escapeHtml(geti18n('social.blocklist.empty'))}</p>`
		return
	}
	container.replaceChildren()
	if (blocked.length) {
		const heading = document.createElement('h3')
		heading.className = 'section-title'
		heading.textContent = geti18n('social.blocklist.title')
		container.appendChild(heading)
		for (const entry of blocked) {
			const row = document.createElement('div')
			row.className = 'blocklist-row'
			const scopeLabel = entry.scope === 'subject'
				? geti18n('social.blocklist.scopeSubject')
				: geti18n('social.blocklist.scopeEntity')
			const actionButton = entry.scope === 'entity'
				? `<button type="button" class="profile-action-btn" data-unblock="${escapeHtml(entry.value)}">${escapeHtml(geti18n('social.blocklist.unblock'))}</button>`
				: ''
			row.innerHTML = `
				<span class="blocklist-kind">${escapeHtml(scopeLabel)}</span>
				<code class="entity-hash">${escapeHtml(entry.value)}</code>
				${actionButton}
			`
			container.appendChild(row)
		}
	}
	if (hidden.length) {
		const heading = document.createElement('h3')
		heading.className = 'section-title'
		heading.textContent = geti18n('social.blocklist.hiddenTitle')
		container.appendChild(heading)
		for (const entry of hidden) {
			const row = document.createElement('div')
			row.className = 'blocklist-row'
			const scopeLabel = entry.scope === 'subject'
				? geti18n('social.blocklist.scopeSubject')
				: geti18n('social.blocklist.scopeEntity')
			const actionButton = entry.scope === 'entity'
				? `<button type="button" class="profile-action-btn" data-unhide="${escapeHtml(entry.value)}">${escapeHtml(geti18n('social.blocklist.unhide'))}</button>`
				: ''
			row.innerHTML = `
				<span class="blocklist-kind">${escapeHtml(scopeLabel)}</span>
				<code class="entity-hash">${escapeHtml(entry.value)}</code>
				${actionButton}
			`
			container.appendChild(row)
		}
	}
}

/**
 * 绑定 profile 帖子无限滚动。
 * @param {string} entityHash owner
 * @param {HTMLElement} container 帖子容器
 * @returns {void}
 */
function bindProfilePostsInfiniteScroll(entityHash, container) {
	const sentinel = ensureScrollSentinel(container, 'profilePostsScrollSentinel')
	bindInfiniteScroll({
		sentinel,
		/** @returns {boolean} 个人帖列表是否仍有下一页 */
		hasMore: () => !!socialState.profilePostsCursor,
		/** @returns {Promise<void>} 追加渲染下一页帖子 */
		onLoad: () => renderProfilePosts(entityHash, container, null, true),
	})
}

/**
 * 渲染资料页帖子列表（可选高亮指定帖）。
 * @param {string} entityHash owner
 * @param {HTMLElement} container 容器
 * @param {string | null} [highlightPostId] 高亮帖
 * @param {boolean} [append=false] 追加下一页
 * @returns {Promise<void>}
 */
export async function renderProfilePosts(entityHash, container, highlightPostId = null, append = false) {
	const cursorQuery = append && socialState.profilePostsCursor
		? `&cursor=${encodeURIComponent(socialState.profilePostsCursor)}`
		: ''
	const data = await socialApi(`/profile/${entityHash}/posts?limit=30${cursorQuery}`)
	if (!append) container.replaceChildren()
	const items = data.items || []
	socialState.profilePostsCursor = data.nextCursor || null
	if (!items.length && !append) {
		container.innerHTML = `<div class="empty">${escapeHtml(geti18n('social.empty.profilePosts'))}</div>`
		disconnectInfiniteScroll()
		return
	}
	for (const item of items) {
		const card = await buildPostCard(item)
		if (highlightPostId && card.dataset.postId === highlightPostId)
			card.classList.add('highlight-post')
		container.appendChild(card)
	}
	bindProfilePostsInfiniteScroll(entityHash, container)
	if (highlightPostId)
		container.querySelector(`[data-post-id="${highlightPostId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/**
 * 渲染资料页点赞列表。
 * @param {string} entityHash owner
 * @param {HTMLElement} container 容器
 * @returns {Promise<void>}
 */
export async function renderProfileLikes(entityHash, container) {
	const data = await socialApi(`/profile/${entityHash}/likes`)
	container.replaceChildren()
	const items = data.items || []
	if (!items.length) {
		container.innerHTML = `<div class="empty">${escapeHtml(geti18n('social.empty.likedPosts'))}</div>`
		return
	}
	for (const item of items)
		container.appendChild(await buildPostCard(item))
}

/**
 * 渲染资料页 following 列表。
 * @param {string} entityHash owner
 * @param {HTMLElement} container 容器
 * @returns {Promise<void>}
 */
export async function renderProfileFollowingList(entityHash, container) {
	const data = await socialApi(`/profile/${entityHash}/following`)
	const following = data.following || []
	container.replaceChildren()
	if (!following.length) {
		container.innerHTML = `<div class="empty">${escapeHtml(geti18n('social.empty.following'))}</div>`
		return
	}
	for (const hash of following) {
		const link = document.createElement('a')
		link.className = 'following-link'
		link.href = formatSocialProfileHref(hash)
		link.innerHTML = `
			${renderAvatarHtml(hash, null)}
			<span>
				<strong>${escapeHtml(authorLabel(hash))}</strong>
				<span class="profile-handle">${escapeHtml(entityHandle(hash))}</span>
			</span>
		`
		container.appendChild(link)
	}
}

/**
 * 刷新当前资料页帖子列表。
 * @param {string | null} [highlightPostId] 高亮帖
 * @returns {Promise<void>}
 */
export async function refreshProfilePosts(highlightPostId = null) {
	if (!socialState.profileEntityHash) return
	socialState.profilePostsCursor = null
	const panel = document.getElementById('profilePostsPanel')
	if (panel)
		await renderProfilePosts(socialState.profileEntityHash, panel, highlightPostId)
}

/**
 * 加载并渲染指定 entity 的资料页。
 * @param {string} entityHash owner
 * @param {string | null} [highlightPostId] 高亮帖
 * @returns {Promise<void>}
 */
export async function loadProfileFor(entityHash, highlightPostId = null) {
	socialState.profileEntityHash = entityHash
	socialState.profilePostsCursor = null
	const [data, followingData] = await Promise.all([
		socialApi(`/profile/${entityHash}`),
		socialApi(`/profile/${entityHash}/following`).catch(() => ({ following: [] })),
	])
	const viewer = viewerEntityHash()
	const isSelf = viewer && entityHash === viewer
	const container = document.getElementById('profileView')
	const name = escapeHtml(authorLabel(entityHash, data.profile))
	const handle = escapeHtml(entityHandle(entityHash))
	const followingCount = (followingData.following || []).length

	const cared = socialState.viewerEntityHash
		? await isCared(socialState.viewerEntityHash, entityHash)
		: false
	const headerActions = isSelf
		? await renderTemplateAsHtmlString('profile_header_actions_self', {})
		: await renderTemplateAsHtmlString('profile_header_actions_other', {
			entityHash: escapeHtml(entityHash),
			isFollowing: data.isFollowing ? '1' : '0',
			followLabel: escapeHtml(data.isFollowing
				? geti18n('social.actions.following')
				: geti18n('social.actions.follow')),
			isCared: cared ? '1' : '0',
			careLabel: escapeHtml(cared
				? geti18n('social.actions.careRemove')
				: geti18n('social.actions.care')),
		})
	const avatarHtml = renderAvatarHtml(entityHash, data.profile, 'profile-avatar')
	const bioHtml = data.profile?.bio ? `<p class="profile-bio">${escapeHtml(data.profile.bio)}</p>` : ''
	const selfSettingsHtml = isSelf
		? await renderTemplateAsHtmlString('profile_self_settings', {
			exploreBlurb: escapeHtml(data.socialMeta?.exploreBlurb || ''),
			hideChecked: data.socialMeta?.hideFromDiscovery ? 'checked' : '',
		})
		: ''

	container.replaceChildren(await renderTemplate('profile_view', {
		headerActions,
		avatarHtml,
		name,
		handle,
		bioHtml,
		postCount: data.postCount || 0,
		followingCount,
		selfSettingsHtml,
	}))

	if (isSelf)
		await renderBlocklist(document.getElementById('blocklistSection'))

	await renderProfilePosts(entityHash, document.getElementById('profilePostsPanel'), highlightPostId)
	await renderProfileLikes(entityHash, document.getElementById('profileLikesPanel'))
	await renderProfileFollowingList(entityHash, document.getElementById('profileFollowingPanel'))
}

/**
 * 加载当前观看者自身资料页。
 * @returns {Promise<void>}
 */
export async function loadProfile() {
	const profileHash = viewerEntityHash()
	if (!profileHash) {
		document.getElementById('profileView').innerHTML = `<div class="empty">${escapeHtml(geti18n('social.empty.noIdentity'))}</div>`
		return
	}
	await loadProfileFor(profileHash)
}

/**
 * 提交对指定帖子的公开回复。
 * @param {string} entityHash 目标
 * @param {string} postId 帖子
 * @param {string} text 回复
 * @returns {Promise<void>}
 */
export async function submitReply(entityHash, postId, text) {
	await socialApi('/posts', {
		method: 'POST',
		body: JSON.stringify({
			text,
			replyTo: { entityHash, postId },
			visibility: 'public',
			locale: document.getElementById('postLocale')?.value.trim() || 'zh-CN',
		}),
	})
}
