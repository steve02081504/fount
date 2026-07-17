import { formatSocialProfileHref } from '../../shared/runUri.mjs'
import { chatApi, socialApi, viewerEntityHash } from '../lib/apiClient.mjs'
import { authorLabel, entityHandle, rememberEntityHandle, renderAvatarHtml } from '../lib/display.mjs'
import { bindInfiniteScroll, disconnectInfiniteScroll, ensureScrollSentinel } from '/scripts/infiniteScroll.mjs'
import { createDOMFromHtmlString, renderTemplate, renderTemplateAsHtmlString } from '/scripts/features/template.mjs'
import { openDialogFromTemplate } from '/scripts/features/dialog.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { isCared } from '/parts/shells:chat/shared/care.mjs'
import {
	configureEntityProfileCard,
	ensureEntityProfileCardStyles,
	paintEntityProfileCard,
	paintEntityProfileExtras,
} from '/parts/shells:chat/shared/entityProfileCard.mjs'
import { appendFeedItemsWithThreads } from '../lib/feedThreads.mjs'
import { bindFeedVideoAutoplay } from '../lib/videoAutoplay.mjs'
import { buildPostCard } from '../postCard.mjs'
import { socialState } from '../state.mjs'

import { renderProfileAlbums } from './albums.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

/** @type {Map<string, Set<string>>} entity → 已加载过的 tab */
const profileLoadedTabs = new Map()

/**
 * @param {string} entityHash 实体
 * @returns {Set<string>} 已加载 tab
 */
function loadedTabsFor(entityHash) {
	let set = profileLoadedTabs.get(entityHash)
	if (!set) {
		set = new Set()
		profileLoadedTabs.set(entityHash, set)
	}
	return set
}

/**
 * 渲染拉黑/隐藏列表 UI。
 * @param {HTMLElement} container 容器
 * @returns {Promise<void>}
 */
export async function renderBlocklist(container) {
	if (!(container instanceof HTMLElement)) return
	const data = await chatApi('/personal-lists')
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
 * 打开个人主页设置（迁移到 settings 视图后由 navigation 处理；保留导出供过渡）。
 * @param {{ hideFromDiscovery?: boolean }} socialMeta 当前 meta
 * @returns {Promise<void>}
 */
export async function openProfileSettingsDialog(socialMeta = {}) {
	socialState.profileSocialMeta = socialMeta || socialState.profileSocialMeta
	const { switchView } = await import('../navigation.mjs')
	await switchView('settings')
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
	await appendFeedItemsWithThreads(container, items, async item => {
		const card = await buildPostCard(item)
		if (highlightPostId && card.dataset.postId === highlightPostId)
			card.classList.add('highlight-post')
		return card
	})
	bindFeedVideoAutoplay(container)
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
	bindFeedVideoAutoplay(container)
}

/**
 * 渲染关系列表行到容器。
 * @param {HTMLElement} container 容器
 * @param {object[]} rows 行
 * @param {string} emptyKey 空态 i18n
 * @returns {void}
 */
function fillRelationshipRows(container, rows, emptyKey) {
	container.replaceChildren()
	if (!rows.length) {
		container.innerHTML = `<div class="empty">${escapeHtml(geti18n(emptyKey))}</div>`
		return
	}
	for (const row of rows) {
		const hash = typeof row === 'string' ? row : row.entityHash
		const profile = typeof row === 'string' ? null : row.profile
		rememberEntityHandle(hash, profile)
		const link = document.createElement('a')
		link.className = 'following-link'
		link.href = formatSocialProfileHref(hash)
		link.innerHTML = `
			${renderAvatarHtml(hash, profile)}
			<span>
				<strong>${escapeHtml(authorLabel(hash, profile))}</strong>
				<span class="profile-handle">${escapeHtml(entityHandle(hash, profile))}</span>
			</span>
		`
		container.appendChild(link)
	}
}

/**
 * 打开关注/粉丝列表对话框。
 * @param {string} entityHash 实体
 * @param {'following' | 'followers'} kind 列表类型
 * @returns {Promise<void>}
 */
export async function openProfileRelationshipList(entityHash, kind) {
	const title = geti18n(kind === 'followers'
		? 'social.profile.followersTitle'
		: 'social.profile.followingTitle')
	const dialog = await openDialogFromTemplate('profile_relationship_list', { title: escapeHtml(title) })
	const list = dialog.querySelector('#profileRelationshipList')
	if (!(list instanceof HTMLElement)) return
	list.innerHTML = `<div class="empty">${escapeHtml(geti18n('social.post.loading'))}</div>`
	const path = kind === 'followers'
		? `/profile/${entityHash}/followers`
		: `/profile/${entityHash}/following`
	const data = await socialApi(path)
	const rows = kind === 'followers' ? data.followers || [] : data.following || []
	fillRelationshipRows(
		list,
		rows,
		kind === 'followers' ? 'social.empty.followers' : 'social.empty.following',
	)
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
 * 激活资料 Tab（懒加载）。
 * @param {string} tab tab id
 * @param {{ force?: boolean }} [options] 强制重载
 * @returns {Promise<void>}
 */
export async function activateProfileTab(tab, options = {}) {
	const entityHash = socialState.profileEntityHash
	if (!entityHash) return
	for (const button of document.querySelectorAll('[data-profile-tab]')) {
		const active = button.dataset.profileTab === tab
		button.classList.toggle('active', active)
		button.classList.toggle('tab-active', active)
		button.setAttribute('aria-selected', active ? 'true' : 'false')
	}
	for (const panel of document.querySelectorAll('[data-profile-panel]'))
		panel.classList.toggle('hidden', panel.dataset.profilePanel !== tab)

	const loaded = loadedTabsFor(entityHash)
	if (!options.force && loaded.has(tab) && tab !== 'posts') return
	loaded.add(tab)

	if (tab === 'posts') {
		const panel = document.getElementById('profilePostsPanel')
		if (panel instanceof HTMLElement && (options.force || !panel.childElementCount))
			await renderProfilePosts(entityHash, panel)
		return
	}
	if (tab === 'albums') {
		const panel = document.getElementById('profileAlbumsPanel')
		if (panel instanceof HTMLElement) await renderProfileAlbums(entityHash, panel)
		return
	}
	if (tab === 'likes') {
		const panel = document.getElementById('profileLikesPanel')
		if (panel instanceof HTMLElement) await renderProfileLikes(entityHash, panel)
		return
	}
	if (tab === 'cabinets') {
		const panel = document.getElementById('profileCabinetsPanel')
		if (panel instanceof HTMLElement) await renderProfileCabinets(entityHash, panel)
	}
}

/**
 * 挂载完整人物卡到资料页宿主。
 * @param {HTMLElement} host 宿主
 * @param {string} entityHash 实体
 * @param {object} profile 资料
 * @returns {Promise<void>}
 */
async function mountProfileEntityCard(host, entityHash, profile) {
	ensureEntityProfileCardStyles()
	const response = await fetch('/parts/shells:chat/src/templates/hub/profile_popup.html')
	const card = createDOMFromHtmlString(await response.text())
	if (!(card instanceof HTMLElement)) return
	configureEntityProfileCard(card, 'embedded')
	card.classList.add('social-profile-entity-card')
	if (!card.querySelector('[data-entity-owned-by-host]')) {
		const ownedHost = document.createElement('div')
		ownedHost.dataset.entityOwnedByHost = ''
		card.querySelector('.hub-profile-popup-body')?.appendChild(ownedHost)
	}
	await paintEntityProfileCard(card, profile, { entityHash })
	const ownerEntityHash = profile?.ownerEntityHash
		? String(profile.ownerEntityHash).toLowerCase()
		: null
	if (ownerEntityHash) {
		let ownerName = null
		try {
			const ownerData = await socialApi(`/profile/${ownerEntityHash}`)
			ownerName = authorLabel(ownerEntityHash, ownerData.profile)
		}
		catch { /* remote miss */ }
		paintEntityProfileExtras(card, { ownerEntityHash, ownerName })
	}
	host.replaceChildren(card)
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
	profileLoadedTabs.delete(entityHash)
	const data = await socialApi(`/profile/${entityHash}`)
	const viewer = viewerEntityHash()
	const isSelf = viewer && entityHash === viewer
	const container = document.getElementById('profileView')
	rememberEntityHandle(entityHash, data.profile)
	socialState.profileSocialMeta = data.socialMeta || {}

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

	container.replaceChildren(await renderTemplate('profile_view', {
		headerActions,
		entityHash: escapeHtml(entityHash),
		postCount: data.postCount || 0,
		followingCount: data.followingCount || 0,
		followerCount: data.followerCount || 0,
	}))

	const cardHost = container.querySelector('#profileEntityCardHost')
	if (cardHost instanceof HTMLElement)
		await mountProfileEntityCard(cardHost, entityHash, data.profile)

	await activateProfileTab('posts', { force: true })
	if (highlightPostId) {
		const panel = document.getElementById('profilePostsPanel')
		if (panel)
			await renderProfilePosts(entityHash, panel, highlightPostId)
	}
}

/**
 * @param {string} entityHash 实体
 * @param {HTMLElement | null} container 容器
 * @returns {Promise<void>}
 */
async function renderProfileCabinets(entityHash, container) {
	if (!container) return
	container.replaceChildren()
	try {
		const response = await fetch(`/api/parts/shells:cabinet/remote/${encodeURIComponent(entityHash)}/cabinets`, {
			credentials: 'include',
		})
		if (!response.ok) throw new Error(await response.text())
		const data = await response.json()
		const cabinets = data.cabinets || []
		if (!cabinets.length) {
			container.innerHTML = `<div class="empty">${escapeHtml(geti18n('social.profile.cabinetsEmpty'))}</div>`
			return
		}
		const list = document.createElement('div')
		list.className = 'flex flex-col gap-2 p-2'
		for (const row of cabinets) {
			const link = document.createElement('a')
			link.className = 'btn btn-ghost justify-start'
			link.href = `/parts/shells:cabinet/#user:${encodeURIComponent(entityHash)}`
			link.textContent = row.name || row.cabinet_id
			list.appendChild(link)
		}
		container.appendChild(list)
	}
	catch (error) {
		console.error(error)
		container.innerHTML = `<div class="empty">${escapeHtml(geti18n('social.profile.cabinetsFailed', { error: error.message || 'failed' }))}</div>`
	}
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
