/**
 * 【文件】public/hub/presence.mjs
 * 【职责】成员/作者 presence 与资料浮层：头像 hydration、悬停资料卡、状态点与资料 API 缓存。
 * 【原理】`applyAvatarsTo`、`bindHoverCardAnchor`、`showHoverCardFor` 驱动消息行与成员列表头像/卡片。`hydrateAuthorLabels` 在消息重绘后补齐作者展示名；不生成气泡主体结构。
 * 【数据结构】hubStore 及模块内 Map/Set 字段；见 core/state 与各函数 JSDoc。
 * 【关联】../src/entityProfileApi、../src/lib/entityHash、core/avatarCover、core/domUtils、core/state、profilePopup
 */
import { memoizePromise } from '../../../../scripts/lib/memo.mjs'
import {
	cachedProfileFromApi,
	fetchEntityProfileApi,
} from '../src/entityProfileApi.mjs'
import { isEntityHash128 } from '../src/lib/entityHash.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

import { mountAvatarCover } from './core/avatarCover.mjs'
import { authorDisplayLabel, authorPresentationKeys, avatarColor, avatarInitial, resolveEntityHashForAuthorKey, warmCharEntityHashCache } from './core/domUtils.mjs'
import { hubStore } from './core/state.mjs'
import { dismissProfilePopup, resolveEntityFromAnchor, showProfilePopup } from './profilePopup.mjs'

/** @typedef {{ avatar: string|null, name: string, description: string, description_markdown: string, tags: string[], links: object[], status: string, customStatus: string }} CachedProfile */

const loadProfileCached = memoizePromise(
	key => key,
	async cacheKey => {
		const sep = cacheKey.indexOf(':')
		const entityHash = sep === -1 ? cacheKey : cacheKey.slice(0, sep)
		const groupId = sep === -1 ? undefined : cacheKey.slice(sep + 1)
		try {
			const data = await fetchEntityProfileApi(entityHash, groupId)
			return cachedProfileFromApi(data?.profile, entityHash)
		}
		catch {
			return null
		}
	},
	{ max: 512 },
)

/**
 * @param {HTMLElement | null} el 状态点元素
 * @param {string} [status] online | idle | dnd | invisible | offline
 * @returns {void}
 */
export function applyStatusDot(el, status) {
	if (!el) return
	el.dataset.status = status || 'offline'
}

/**
 * @param {HTMLElement | null} bioEl 简介容器
 * @param {string} [bio] 简介正文
 * @returns {void}
 */
export function applyBioElement(bioEl, bio) {
	if (!bioEl) return
	const text = String(bio || '').trim()
	if (text) {
		delete bioEl.dataset.i18n
		bioEl.textContent = text
	}
	else {
		bioEl.textContent = ''
		bioEl.dataset.i18n = 'chat.hub.bioEmpty'
	}
}

/**
 * @param {string} status 状态键
 * @param {string} [customStatus] 自定义状态文案
 * @returns {Promise<string>} 展示用状态文案
 */
export async function formatStatusLabel(status, customStatus = '') {
	const custom = String(customStatus || '').trim()
	if (custom) return custom
	const { geti18n } = await import('../../../../scripts/i18n/index.mjs')
	const key = `chat.hub.status.${status || 'offline'}`
	const label = await geti18n(key)
	return label !== key ? label : status
}

/**
 * 拉取并缓存实体资料（头像、bio、状态）；仅接受 128 位 entityHash。
 * @param {string} [entityHash] 128 位 entityHash
 * @param {{ bypassCache?: boolean, groupId?: string }} [options] bypassCache 跳过缓存；groupId 当前群以解析 persona
 * @returns {Promise<CachedProfile|null>} 缓存条目；失败为 null
 */
export async function fetchUserProfile(entityHash, options = {}) {
	if (!entityHash || !isEntityHash128(entityHash)) return null
	const key = String(entityHash).toLowerCase()
	const cacheKey = options.groupId ? `${key}:${options.groupId}` : key
	if (options.bypassCache) 
		try {
			const data = await fetchEntityProfileApi(key, options.groupId)
			return cachedProfileFromApi(data?.profile, key)
		}
		catch {
			return null
		}
	
	return loadProfileCached(cacheKey)
}

/**
 * 按 authorKey（pubKeyHash / entityHash / 角色 part 名）拉取资料。
 * @param {string} authorKey 发送者键
 * @param {{ bypassCache?: boolean, groupId?: string }} [options] 选项
 * @returns {Promise<CachedProfile|null>} 资料或 null
 */
export async function fetchAuthorProfile(authorKey, options = {}) {
	const key = String(authorKey || '').trim()
	if (!key) return null
	let profileKey = resolveEntityHashForAuthorKey(key)
	if (!profileKey && !isEntityHash128(key)) {
		await warmCharEntityHashCache([key])
		profileKey = resolveEntityHashForAuthorKey(key)
	}
	if (!profileKey || !isEntityHash128(profileKey)) return null
	return fetchUserProfile(profileKey, options)
}

/**
 * 立即更新成员列表中当前 viewer 行的状态点（不等待资料拉取）。
 * @param {string} status 状态键
 * @returns {void}
 */
export function applySelfStatusToMemberList(status) {
	const viewerEh = hubStore.viewerEntityHash
	if (!viewerEh) return
	const root = document.getElementById('hub-member-list')
	if (!root) return
	const key = viewerEh.toLowerCase()
	root.querySelectorAll('.hub-member-avatar[data-avatar-for]').forEach((av) => {
		if (av.dataset.avatarFor?.toLowerCase() !== key) return
		const dot = av.closest('.hub-member-avatar-wrap')?.querySelector('.hub-status-dot')
		applyStatusDot(dot, status)
	})
}

/**
 * 使指定实体资料缓存失效。
 * @param {string} entityHash 128 位 entityHash
 * @returns {void}
 */
export function invalidateUserProfileCache(entityHash) {
	if (!entityHash) return
	const key = String(entityHash).toLowerCase()
	loadProfileCached.deleteMatching(cacheKey =>
		cacheKey === key || cacheKey.startsWith(`${key}:`),
	)
}

/**
 * 为元素绑定悬停显示资料卡的行为。
 * @param {HTMLElement} el 锚点元素
 * @param {() => string|null|undefined} getUname 返回当前关联用户名的函数
 * @returns {void}
 */
export function bindHoverCardAnchor(el, getUname) {
	if (!el || el.dataset.hoverBound) return
	el.dataset.hoverBound = '1'
	el.addEventListener('mouseenter', () => {
		const uname = getUname()
		if (uname) showHoverCardFor(uname, el)
	})
	el.addEventListener('mouseleave', (e) => {
		if (hoverCard?.contains(e.relatedTarget)) return
		hideHoverCard()
	})
}

/**
 * 为容器内头像占位符加载图片并绑定资料卡锚点。
 * @param {HTMLElement} rootEl 消息或成员列表根节点
 * @returns {void}
 */
export function applyAvatarsTo(rootEl) {
	rootEl.querySelectorAll('[data-avatar-for]').forEach((av) => {
		const authorKey = av.dataset.avatarFor
		if (!authorKey) return
		const { profileKey } = authorPresentationKeys(authorKey)
		bindHoverCardAnchor(av, () => av.dataset.avatarFor)
		if (av.dataset.avatarLoaded) return
		av.dataset.avatarLoaded = '1'
		void fetchAuthorProfile(profileKey, { groupId: hubStore.currentGroupId || undefined }).then((profile) => {
			if (!profile) return
			if (profile.avatar) {
				const avatarVal = String(profile.avatar)
				const isUrl = avatarVal.startsWith('http') || avatarVal.startsWith('/') || avatarVal.startsWith('data:')
				if (isUrl)
					void mountAvatarCover(av, avatarVal, escapeHtml(profile.name || authorDisplayLabel(authorKey)))
				else {
					// 表情或文字头像：直接替换为文本内容
					av.textContent = avatarVal
					av.style.fontSize = '20px'
					av.style.background = ''
				}
			}
			const dot = av.closest('.hub-member-avatar-wrap, .hub-avatar-wrap')?.querySelector('.hub-status-dot')
			if (dot) applyStatusDot(dot, profile.status)
		})
	})
	rootEl.querySelectorAll('.hub-message-author, .hub-system-author').forEach((au) => {
		bindHoverCardAnchor(au, () => au.dataset.authorKey || au.textContent.trim())
	})
	void hydrateAuthorLabels(rootEl)
}

/**
 * 异步将消息作者名替换为资料卡 displayName（保留 data-author-key）。
 * @param {HTMLElement} rootEl 消息列表根节点
 * @returns {Promise<void>}
 */
export async function hydrateAuthorLabels(rootEl) {
	const tasks = []
	rootEl.querySelectorAll('.hub-message-author[data-author-key]').forEach((au) => {
		const key = au.dataset.authorKey?.trim()
		if (!key || key === '?') return
		tasks.push((async () => {
			const profile = await fetchAuthorProfile(key, { groupId: hubStore.currentGroupId || undefined })
			if (!profile?.name || au.dataset.authorKey !== key) return
			au.textContent = profile.name
		})())
	})
	await Promise.all(tasks)
}

// ============ Profile hover card ============

const hoverCard = document.getElementById('hub-profile-hover-card')
let hoverCardHideTimer = null

/**
 * 在鼠标锚点附近展示用户资料悬浮卡并异步加载信息。
 * @param {string} authorKey 发送者键（pubKeyHash / entityHash / 角色名）
 * @param {HTMLElement} anchorEl 用于定位的锚点元素
 * @returns {Promise<void>}
 */
export async function showHoverCardFor(authorKey, anchorEl) {
	if (!authorKey || !hoverCard) return
	clearTimeout(hoverCardHideTimer)
	if (hoverCard.classList.contains('show') && hoverCard.dataset.uname === authorKey) return
	hoverCard.dataset.uname = authorKey
	const rect = anchorEl.getBoundingClientRect()
	let left = rect.right + 8
	let {top} = rect
	if (left + 280 > window.innerWidth) left = rect.left - 288
	if (top + 320 > window.innerHeight) top = window.innerHeight - 330
	if (top < 8) top = 8
	hoverCard.style.left = left + 'px'
	hoverCard.style.top = top + 'px'

	const { displayName, profileKey } = authorPresentationKeys(authorKey)
	const hoverCardName = document.getElementById('hover-card-name')
	const hoverCardStatusText = document.getElementById('hover-card-status-text')
	const hoverCardStatusDot = document.getElementById('hover-card-status-dot')
	const hoverCardAvatarLetter = document.getElementById('hover-card-avatar-letter')
	const hoverCardAvatar = document.getElementById('hover-card-avatar')
	const hoverCardBio = document.getElementById('hover-card-bio')
	if (hoverCardAvatarLetter) hoverCardAvatarLetter.textContent = avatarInitial(displayName)
	if (hoverCardAvatar) {
		hoverCardAvatar.style.background = avatarColor(displayName)
		hoverCardAvatar.dataset.uname = authorKey
	}
	if (hoverCardName) hoverCardName.textContent = displayName
	if (hoverCardStatusText) hoverCardStatusText.textContent = ''
	applyStatusDot(hoverCardStatusDot, 'offline')
	if (hoverCardBio) hoverCardBio.dataset.i18n = 'chat.hub.loading'
	hoverCard.classList.add('show')

	const profile = await fetchAuthorProfile(profileKey, { groupId: hubStore.currentGroupId || undefined })
	if (hoverCardAvatar?.dataset.uname !== authorKey) return
	if (profile) {
		if (hoverCardName) hoverCardName.textContent = profile.name || displayName
		if (profile.avatar && hoverCardAvatar instanceof HTMLElement)
			await mountAvatarCover(hoverCardAvatar, profile.avatar, '')
		applyStatusDot(hoverCardStatusDot, profile.status)
		if (hoverCardStatusText)
			hoverCardStatusText.textContent = await formatStatusLabel(profile.status, profile.customStatus)
		const { profileDescriptionText } = await import('./entityProfile.mjs')
		applyBioElement(hoverCardBio, profileDescriptionText(profile))
	}
	else
		applyBioElement(hoverCardBio, '')
}

/**
 * 延迟隐藏 hover 资料卡。
 * @returns {void}
 */
export function hideHoverCard() {
	if (!hoverCard) return
	clearTimeout(hoverCardHideTimer)
	hoverCardHideTimer = setTimeout(() => {
		hoverCard.classList.remove('show')
		delete hoverCard.dataset.uname
	}, 220)
}

/**
 * 从事件目标元素解析应关联的用户名。
 * @param {EventTarget|null} target DOM 事件目标
 * @returns {string|null} 有效用户名；无法解析则为 null
 */
function getAnchorUsername(target) {
	if (!target) return null
	let uname = target.dataset?.avatarFor
	if (!uname)
		if (target.classList?.contains('hub-message-author') || target.classList?.contains('hub-system-author'))
			uname = target.dataset.authorKey || target.textContent?.trim()
	return uname && uname !== '?' ? uname : null
}

if (hoverCard) {
	hoverCard.addEventListener('mouseenter', () => clearTimeout(hoverCardHideTimer))
	hoverCard.addEventListener('mouseleave', hideHoverCard)
}

const PROFILE_CLICK_SKIP = '.hub-message-actions, .hub-trust-author-button, .hub-block-author-button, .hub-save-emoji-button, .hub-save-sticker-button, .hub-vote-option, .hub-reactions, #hub-profile-popup-layer, .hub-profile-popup, .hub-profile-popup-dm-button, .hub-profile-popup-close, button, a, input, textarea, select'

/**
 * 注册头像悬停卡与点击资料弹层（由 wireEvents 显式调用）。
 * @returns {void}
 */
export function wirePresenceInteractions() {
	document.addEventListener('mouseover', (event) => {
		const target = event.target.closest('[data-avatar-for], .hub-message-author, .hub-system-author')
		if (!target || target.contains(event.relatedTarget)) return
		const uname = getAnchorUsername(target)
		if (uname) showHoverCardFor(uname, target)
	})
	document.addEventListener('mouseout', (event) => {
		const target = event.target.closest('[data-avatar-for], .hub-message-author, .hub-system-author')
		if (!target || target.contains(event.relatedTarget)) return
		if (hoverCard?.contains(event.relatedTarget)) return
		hideHoverCard()
	})

	document.addEventListener('click', event => {
		if (event.target.closest(PROFILE_CLICK_SKIP)) return
		const target = event.target.closest(
			'[data-avatar-for], .hub-message-author, .hub-member-avatar, .hub-member-name, .hub-system-author',
		)
		if (!target) return
		void (async () => {
			const entity = await resolveEntityFromAnchor(target)
			if (!entity) return
			dismissProfilePopup()
			await showProfilePopup(entity)
		})()
	})
}
