/**
 * 【文件】public/hub/presence.mjs
 * 【职责】成员/作者 presence 与资料浮层：头像 hydration、悬停资料卡、状态点与资料 API 缓存。
 * 【原理】`applyAvatarsTo`、`bindHoverCardAnchor`、`showHoverCardFor` 驱动消息行与成员列表头像/卡片。
 * 悬停卡走共享 `entityProfileHoverCard`（与点击弹层同一 `paintEntityProfileCard`）；消息区仅文档委托 `wireEntityProfileHover`，避免头像与作者名双重 bind 叠卡。`hydrateAuthorLabels` 在消息重绘后补齐作者展示名。
 * 【数据结构】store 及模块内 Map/Set 字段；见 core/state 与各函数 JSDoc。
 * 【关联】../src/entityProfileApi、../src/lib/entityHash、core/avatarCover、core/domUtils、core/state、profilePopup、shared/entityProfileHoverCard
 */
import { isHex64 } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'

import { memoizePromise } from '../../../../scripts/lib/memo.mjs'
import { aliasForEntity } from '../shared/aliases.mjs'
import { deriveMessageAttribution } from '../shared/attribution.mjs'
import { isEntityHash128 } from '../shared/entityHash.mjs'
import {
	bindEntityProfileHoverAnchor,
	hideEntityProfileHoverCard,
	showEntityProfileHoverCard,
	wireEntityProfileHover,
} from '../shared/entityProfileHoverCard.mjs'
import { displayProfileAvatar } from '../shared/hashAvatar.mjs'
import { resolveDisplayName } from '../shared/nameResolve.mjs'
import {
	cachedProfileFromApi,
	fetchEntityProfileApi,
} from '../src/entityProfileApi.mjs'

import { applyProfileAvatarToHost } from './core/avatarCover.mjs'
import {
	authorDisplayLabel,
	authorPresentationKeys,
	memberDisplayNameForAuthorKey,
	resolveEntityHashForAuthorKey,
	warmCharEntityHashCache,
} from './core/domUtils.mjs'
import { store } from './core/state.mjs'
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
 * @param {HTMLElement | null} bioElement 简介容器
 * @param {string} [bio] 简介 markdown 源
 * @param {string} [entityHash] 作者 hash
 * @param {{ ownerEntityHash?: string | null }} [_options] 兼容旧调用（所属主人不再影响 bio 信任）
 * @returns {Promise<void>}
 */
export async function applyBioElement(bioElement, bio, entityHash = '', _options = {}) {
	if (!bioElement) return
	const { paintEntityProfileBio } = await import('../shared/entityProfileCard.mjs')
	const { store: hubStore } = await import('./core/state.mjs')
	await paintEntityProfileBio(bioElement, bio, entityHash, {
		selfEntityHash: hubStore.viewer?.viewerEntityHash,
		nodeHash: hubStore.viewer?.nodeHash,
		viewerOwnerEntityHash: hubStore.viewer?.ownerEntityHash,
	})
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
	const viewerEh = store.viewer.viewerEntityHash
	if (!viewerEh) return
	const root = document.getElementById('member-list')
	if (!root) return
	const key = viewerEh.toLowerCase()
	root.querySelectorAll('.member-avatar[data-avatar-for]').forEach((av) => {
		if (av.dataset.avatarFor?.toLowerCase() !== key) return
		const dot = av.closest('.member-avatar-wrap')?.querySelector('.status-dot')
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
 * 清空全部实体资料缓存（如 user.sfw 切换后）。
 * @returns {void}
 */
export function invalidateAllUserProfileCaches() {
	loadProfileCached.deleteMatching(() => true)
}

/**
 * 清除容器内指定作者键的头像已加载标记。
 * @param {HTMLElement} root 容器
 * @param {Set<string>} authorKeys 小写作者键
 * @returns {void}
 */
function clearAvatarLoadedForAuthorKeys(root, authorKeys) {
	if (!authorKeys.size) return
	root.querySelectorAll('[data-avatar-for]').forEach((av) => {
		const key = av.dataset.avatarFor?.trim().toLowerCase()
		if (key && authorKeys.has(key))
			delete av.dataset.avatarLoaded
	})
}

/**
 * 收集与 entityHash 关联的 `data-avatar-for` 键。
 * @param {string} entityHash 128 位 entityHash
 * @returns {Promise<Set<string>>} 小写作者键
 */
async function authorKeysForEntityHash(entityHash) {
	const key = String(entityHash || '').trim().toLowerCase()
	/** @type {Set<string>} */
	const keys = new Set()
	if (!isEntityHash128(key)) return keys
	keys.add(key)

	for (const member of store.context.currentState?.members || []) {
		if (String(member.entityHash || '').toLowerCase() !== key) continue
		if (member.memberKey) keys.add(String(member.memberKey).toLowerCase())
		if (member.pubKeyHash) keys.add(String(member.pubKeyHash).toLowerCase())
		if (member.charname) keys.add(String(member.charname).toLowerCase())
	}

	const { charAgentEntityHash } = await import('./entityResolve.mjs')
	const { resolveFriendBinding } = await import('./friendBindings.mjs')

	for (const agent of store.viewer.agents || []) {
		if (String(agent.entityHash || '').toLowerCase() !== key) continue
		const name = String(agent.charPartName || '').trim()
		if (name) keys.add(name.toLowerCase())
	}

	for (const group of store.sidebar.groups) {
		const binding = resolveFriendBinding(group)
		if (String(binding?.entityHash || '').toLowerCase() !== key) continue
		if (binding.charname) keys.add(String(binding.charname).toLowerCase())
	}

	const charname = store.privateGroup?.charname
	if (charname) {
		const eh = await charAgentEntityHash(charname)
		if (eh === key) keys.add(String(charname).toLowerCase())
	}

	return keys
}

/**
 * 资料保存或从角色 part 强制同步后重绘 Hub 可见资料面。
 * @param {string} entityHash 128 位 entityHash
 * @returns {Promise<void>}
 */
export async function refreshHubAfterProfileChange(entityHash) {
	const key = String(entityHash || '').trim().toLowerCase()
	if (!isEntityHash128(key)) return

	invalidateUserProfileCache(key)
	hideEntityProfileHoverCard()
	const authorKeys = await authorKeysForEntityHash(key)

	const messageList = document.getElementById('messages')
	const memberList = document.getElementById('member-list')
	if (messageList instanceof HTMLElement) {
		clearAvatarLoadedForAuthorKeys(messageList, authorKeys)
		applyAvatarsTo(messageList)
		await hydrateAuthorLabels(messageList)
	}
	if (memberList instanceof HTMLElement) {
		clearAvatarLoadedForAuthorKeys(memberList, authorKeys)
		applyAvatarsTo(memberList)
	}

	const viewerEh = String(store.viewer?.viewerEntityHash || '').toLowerCase()
	if (viewerEh === key) {
		const { refreshViewerHubPresentation } = await import('./init.mjs')
		await refreshViewerHubPresentation()
	}

	const charname = store.privateGroup?.charname
	if (charname) {
		const { charAgentEntityHash } = await import('./entityResolve.mjs')
		if (await charAgentEntityHash(charname) === key) {
			const { getCharDetails, renderCharInfoCardActive } = await import('./charCard.mjs')
			await renderCharInfoCardActive(charname, await getCharDetails(charname))
		}
	}

	const { resolveFriendBinding } = await import('./friendBindings.mjs')
	const inFriends = store.sidebar.groups.some((group) => {
		const binding = resolveFriendBinding(group)
		return String(binding?.entityHash || '').toLowerCase() === key
	})
	if (store.context.currentMode === 'friends' || inFriends) {
		const { loadFriendsList, renderFriendsColumn } = await import('./friendsList.mjs')
		await renderFriendsColumn(await loadFriendsList())
	}

	const inCurrentMembers = (store.context.currentState?.members || [])
		.some(member => String(member.entityHash || '').toLowerCase() === key)
	if (inCurrentMembers && store.context.currentState) {
		const { renderMemberList } = await import('./sidebar/index.mjs')
		await renderMemberList(store.context.currentState)
	}
}

/**
 * SFW 开关变更后重绘 Hub 可见资料面。
 * @returns {Promise<void>}
 */
export async function refreshHubAfterSfwChange() {
	invalidateAllUserProfileCaches()
	const messageList = document.getElementById('messages')
	const memberList = document.getElementById('member-list')
	if (messageList instanceof HTMLElement) {
		messageList.querySelectorAll('[data-avatar-for]').forEach(av => { delete av.dataset.avatarLoaded })
		applyAvatarsTo(messageList)
		await hydrateAuthorLabels(messageList)
	}
	if (memberList instanceof HTMLElement)
		if (store.context.currentState) {
			const { renderMemberList } = await import('./sidebar/index.mjs')
			await renderMemberList(store.context.currentState)
		}
		else {
			memberList.querySelectorAll('[data-avatar-for]').forEach(av => { delete av.dataset.avatarLoaded })
			applyAvatarsTo(memberList)
		}

	const { refreshViewerHubPresentation } = await import('./init.mjs')
	await refreshViewerHubPresentation()

	const charname = store.privateGroup?.charname
	if (charname) {
		const { getCharDetails, renderCharInfoCardActive } = await import('./charCard.mjs')
		await renderCharInfoCardActive(charname, await getCharDetails(charname))
	}

	if (store.context.currentMode === 'friends') {
		const { loadFriendsList, renderFriendsColumn } = await import('./friendsList.mjs')
		await renderFriendsColumn(await loadFriendsList())
	}
}

/**
 * @param {string} authorKey 发送者键
 * @param {HTMLElement} [anchorElement] 锚点（优先走 resolveEntityFromAnchor）
 * @returns {Promise<object | null>} hover 卡选项
 */
async function hoverOptionsForAuthor(authorKey, anchorElement) {
	const entity = anchorElement instanceof HTMLElement
		? await resolveEntityFromAnchor(anchorElement)
		: null
	const profileKey = entity?.entityHash
		|| authorPresentationKeys(authorKey).profileKey
		|| String(authorKey || '').trim()
	if (!profileKey) return null
	const groupId = store.context.currentGroupId || undefined
	const fallbackName = entity?.displayName
		|| authorPresentationKeys(authorKey).displayName
		|| profileKey
	const resolvedEntityHash = entity?.entityHash || null
	/**
	 * @returns {Promise<object|null>} 缓存资料
	 */
	function loadProfile() {
		return resolvedEntityHash
			? fetchUserProfile(resolvedEntityHash, { groupId })
			: fetchAuthorProfile(profileKey, { groupId })
	}
	return {
		cacheKey: resolvedEntityHash || authorKey || profileKey,
		entityHash: resolvedEntityHash || (isEntityHash128(profileKey) ? profileKey : null),
		displayName: fallbackName,
		groupId,
		loadProfile,
		wireActions: true,
		entity: entity || {
			entityHash: resolvedEntityHash || (isEntityHash128(profileKey) ? profileKey : null),
			charname: null,
			pubKeyHex: null,
			pubKeyHash: isHex64(profileKey) ? profileKey : null,
			displayName: fallbackName,
		},
		paintOptions: {
			selfEntityHash: store.viewer?.viewerEntityHash,
			nodeHash: store.viewer?.nodeHash,
			viewerOwnerEntityHash: store.viewer?.ownerEntityHash,
		},
		attribution: entity?.attribution || null,
	}
}

/**
 * 为元素绑定悬停显示资料卡的行为。
 * @param {HTMLElement} el 锚点元素
 * @param {() => string|null|undefined} getUname 返回当前关联用户名的函数
 * @returns {void}
 */
export function bindHoverCardAnchor(el, getUname) {
	bindEntityProfileHoverAnchor(el, async () => {
		const uname = getUname()
		return uname ? hoverOptionsForAuthor(uname, el) : null
	})
}

/**
 * 为容器内头像占位符加载图片并绑定资料卡锚点。
 * @param {HTMLElement} rootElement 消息或成员列表根节点
 * @returns {void}
 */
export function applyAvatarsTo(rootElement) {
	// 悬停卡由 wirePresenceInteractions → wireEntityProfileHover 文档委托，勿再 per-element bind（头像↔名字切换会叠卡）
	rootElement.querySelectorAll('[data-avatar-for]').forEach((av) => {
		const authorKey = av.dataset.avatarFor
		if (!authorKey) return
		const { profileKey } = authorPresentationKeys(authorKey)
		if (av.dataset.avatarLoaded) return
		av.dataset.avatarLoaded = '1'
		void fetchAuthorProfile(profileKey, { groupId: store.context.currentGroupId || undefined }).then((profile) => {
			if (!profile) return
			const entityHash = resolveEntityHashForAuthorKey(authorKey) || profileKey
			void applyProfileAvatarToHost(av, {
				seed: profileKey,
				label: resolveDisplayName({
					entityHash,
					alias: entityHash ? aliasForEntity(entityHash) : '',
					profileName: profile.name,
					fallbackLabel: authorDisplayLabel(authorKey),
				}),
				avatar: displayProfileAvatar(profile),
			})
			const dot = av.closest('.member-avatar-wrap, .avatar-wrap')?.querySelector('.status-dot')
			if (dot) applyStatusDot(dot, profile.status)
		})
	})
	void hydrateAuthorLabels(rootElement)
}

/**
 * 异步将消息作者名补齐为 resolveDisplayName 结果（alias 优先于 profile.name；保留 data-author-key）。
 * @param {HTMLElement} rootElement 消息列表根节点
 * @returns {Promise<void>}
 */
export async function hydrateAuthorLabels(rootElement) {
	const tasks = []
	rootElement.querySelectorAll('.message-author[data-author-key]').forEach((au) => {
		const key = au.dataset.authorKey?.trim()
		if (!key || key === '?') return
		tasks.push((async () => {
			const profile = await fetchAuthorProfile(key, { groupId: store.context.currentGroupId || undefined })
			if (au.dataset.authorKey !== key) return
			const entityHash = resolveEntityHashForAuthorKey(key)
			au.textContent = resolveDisplayName({
				entityHash: entityHash || undefined,
				alias: entityHash ? aliasForEntity(entityHash) : '',
				profileName: profile?.name,
				fallbackLabel: au.textContent?.trim()
					|| memberDisplayNameForAuthorKey(key)
					|| undefined,
			})
		})())
	})
	await Promise.all(tasks)
}

/**
 * 在鼠标锚点附近展示用户资料悬浮卡并异步加载信息。
 * @param {string} authorKey 发送者键（pubKeyHash / entityHash / 角色名）
 * @param {HTMLElement} anchorElement 用于定位的锚点元素
 * @returns {Promise<void>}
 */
export async function showHoverCardFor(authorKey, anchorElement) {
	const options = await hoverOptionsForAuthor(authorKey, anchorElement)
	if (options) await showEntityProfileHoverCard(anchorElement, options)
}

/** @type {typeof hideEntityProfileHoverCard} */
export const hideHoverCard = hideEntityProfileHoverCard

/**
 * 从事件目标元素解析应关联的用户名。
 * @param {EventTarget|null} target DOM 事件目标
 * @returns {string|null} 有效用户名；无法解析则为 null
 */
function getAnchorUsername(target) {
	if (!(target instanceof HTMLElement)) return null
	let uname = target.dataset?.avatarFor
	if (!uname)
		if (target.classList?.contains('message-author') || target.classList?.contains('system-author'))
			uname = target.dataset.authorKey || target.textContent?.trim()
	return uname && uname !== '?' ? uname : null
}

const PROFILE_CLICK_SKIP = '.message-actions, .trust-author-button, .block-author-button, .save-emoji-button, .save-sticker-button, .vote-option, .reactions, #profile-popup-layer, .profile-popup, .profile-popup-dm-button, .profile-popup-close, button, a, input, textarea, select'

/**
 * 注册头像悬停卡与点击资料弹层（由 wireEvents 显式调用）。
 * @returns {void}
 */
export function wirePresenceInteractions() {
	wireEntityProfileHover(
		'[data-avatar-for], .message-author, .system-author',
		(target) => {
			const uname = getAnchorUsername(target)
			return uname ? hoverOptionsForAuthor(uname, target) : null
		},
	)

	document.addEventListener('click', event => {
		if (event.target.closest(PROFILE_CLICK_SKIP)) return
		const target = event.target.closest(
			'[data-avatar-for], .message-author, .member-avatar, .member-name, .system-author',
		)
		if (!target) return
		void (async () => {
			const entity = await resolveEntityFromAnchor(target)
			if (!entity) return
			const messageRow = target.closest('.message[data-message-id]')
			if (messageRow?.dataset.attributionMismatch === '1') {
				const eventId = messageRow.dataset.messageId
				const channelMessages = store.messages?.channelMessages || []
				const msg = channelMessages.find(row => String(row.eventId) === String(eventId))
				if (msg)
					entity.attribution = deriveMessageAttribution(msg.content, {
						sender: msg.sender || msg.authorPubKeyHash,
					})
				else
					entity.attribution = { trusted: false, mismatch: true, reason: 'imported_resign' }
			}
			dismissProfilePopup()
			await showProfilePopup(entity)
		})()
	})
}
