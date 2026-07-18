/**
 * 【文件】public/hub/friendChat.mjs
 * 【职责】好友私聊入口：查找或创建 DM 群、绑定角色/用户、切换 Hub 到私聊布局并连接群组 WS。
 * 【原理】`enterFriendChat` 渲染活跃角色卡、调整侧栏高亮与 composer；`dispatchFriendChat` 处理列表点击；设置 `store.privateGroup` 后加载默认频道消息，与群聊共用 `messages` 管道。
 * 【数据结构】store（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】由 `hashNav.navigateFromHash` 在解析到好友绑定 groupId 时调用本模块；../../../../scripts/template、../../../../scripts/toast、groupCore/Dm/federationSettings、groupFriendBinding、fount-p2p/core/hexIds、charCard。
 */
import { isHex64 } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'

import { mountTemplate } from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { aliasForEntity } from '../shared/aliases.mjs'
import { isEntityHash128 } from '../shared/entityHash.mjs'
import { buildCharFriendBinding, buildUserFriendBinding, normalizeFriendBinding } from '../shared/friendBinding.mjs'
import { getFederationSettings } from '../src/api/federationSettings.mjs'
import { getGroupState } from '../src/api/groupCore.mjs'
import { createDirectMessageByPubKeys } from '../src/api/groupDm.mjs'
import { setGroupFriendBinding } from '../src/api/groupFriendBinding.mjs'
import { handleUIError, toError } from '../src/ui/errors.mjs'

import { getCharDetails, renderCharInfoCardActive } from './charCard.mjs'
import { store } from './core/state.mjs'
import { parseHash, updateFriendsHash } from './core/urlHash.mjs'
import { friendBindingForGroup } from './friendBindings.mjs'
import { cancelScheduledChannelRefresh } from './messages/channelRefreshScheduler.mjs'
import { setActiveModeTab, setMode } from './mode.mjs'
import { loadGroups } from './serverBar.mjs'
import { selectChannel } from './sidebar/index.mjs'
import { closeGroupWebSocket } from './stream/index.mjs'

/** @type {AbortController | null} 当前进行中的私聊进入操作 */
let enterFriendChatAbort = null

/** @type {Promise<void>} 串行化 resolveFriendGroupId，避免并发重复建群 */
let resolveFriendGroupChain = Promise.resolve()

/**
 * @param {string} url fetch URL
 * @param {RequestInit} [init] fetch 选项
 * @param {AbortSignal} [signal] 取消信号
 * @returns {Promise<Response>} HTTP 响应
 */
async function chatRuntimeFetch(url, init = {}, signal) {
	if (signal?.aborted)
		throw new DOMException('Aborted', 'AbortError')
	try {
		return await fetch(url, { credentials: 'include', ...init, signal })
	}
	catch (error) {
		if (signal?.aborted || error?.name === 'AbortError') throw error
		const err = toError(error)
		throw new Error(`fetch ${url}: ${err.message}`, { cause: err })
	}
}

/**
 * @param {import('../shared/friendBinding.mjs').FriendBinding | null} a 绑定 A
 * @param {import('../shared/friendBinding.mjs').FriendBinding | null} b 绑定 B
 * @returns {boolean} 是否等价（领域键：entityHash + charname）
 */
function friendBindingsEqual(a, b) {
	const na = a ? normalizeFriendBinding(a) : null
	const nb = b ? normalizeFriendBinding(b) : null
	if (!na || !nb) return !na && !nb
	return na.entityHash === nb.entityHash
		&& (na.charname || '') === (nb.charname || '')
}

/**
 * @param {AbortSignal} signal 取消信号
 * @returns {void}
 */
function throwIfAborted(signal) {
	if (signal.aborted)
		throw new DOMException('Aborted', 'AbortError')
}

/**
 * @param {() => Promise<T>} fn 解析群 ID
 * @param {AbortSignal} signal 取消信号
 * @returns {Promise<T>} `fn` 的解析结果
 * @template T
 */
function enqueueResolveFriendGroup(fn, signal) {
	const run = resolveFriendGroupChain.then(async () => {
		throwIfAborted(signal)
		return fn()
	})
	resolveFriendGroupChain = run.catch(() => {})
	return run
}

/**
 * 查找已绑定该角色 entityHash 的好友群。
 * @param {import('../shared/friendBinding.mjs').FriendBinding} binding 绑定
 * @returns {Promise<string|null>} 群 ID
 */
async function findExistingFriendGroup(binding) {
	await loadGroups()
	const matches = store.sidebar.groups.filter(g => g.friendBinding?.entityHash === binding.entityHash)
	if (!matches.length) return null
	matches.sort((a, b) => new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0))
	return matches[0].groupId ?? null
}

/**
 * 确保群上已挂载角色 part。
 * @param {string} groupId 群 ID
 * @param {string} charname 角色名
 * @param {AbortSignal} signal 取消信号
 * @returns {Promise<void>}
 */
async function ensureCharOnGroup(groupId, charname, signal) {
	const base = `/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}`
	const cr = await chatRuntimeFetch(`${base}/chars`, {}, signal)
	if (!cr.ok) throw new Error(`GET chars HTTP ${cr.status}`)
	const chars = await cr.json()
	if (Array.isArray(chars) && chars.includes(charname)) return
	const add = await chatRuntimeFetch(`${base}/char`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ charname, deferGreeting: true }),
	}, signal)
	if (!add.ok) throw new Error(`POST char HTTP ${add.status}`)
}

/**
 * 解析或新建好友群 ID（角色需 addchar；用户 DM 由调用方传入 groupId）。
 * @param {import('../shared/friendBinding.mjs').FriendBinding} binding 绑定
 * @param {{ groupId?: string, forceNew?: boolean }} options 选项
 * @param {AbortSignal} signal 取消信号
 * @returns {Promise<string|null>} 群 ID；失败为 null
 */
async function resolveFriendGroupId(binding, options, signal) {
	let groupId = options.forceNew ? undefined : options.groupId
	if (groupId) {
		if (binding.charname)
			await ensureCharOnGroup(groupId, binding.charname, signal)
		return groupId
	}
	if (!groupId && !options.forceNew) {
		const fromHash = parseHash().groupId
		if (fromHash) groupId = fromHash
	}
	if (!groupId && !options.forceNew)
		groupId = await findExistingFriendGroup(binding)

	if (!groupId) {
		const r = await chatRuntimeFetch('/api/parts/shells:chat/groups', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				friendBinding: binding,
				...options.forceNew ? { forceNew: true } : {},
			}),
		}, signal)
		if (!r.ok) throw new Error(`POST groups HTTP ${r.status}`)
		const payload = await r.json()
		groupId = payload.groupId
	}

	if (binding.charname)
		await ensureCharOnGroup(groupId, binding.charname, signal)

	return groupId
}

/**
 * @param {object} state 群 state
 * @param {string | null | undefined} preferredChannelId 优先频道
 * @returns {string} 可用频道 ID
 */
function resolvePrivateChannelId(state, preferredChannelId) {
	const channels = state?.channels || {}
	const defaultId = state?.groupSettings?.defaultChannelId || 'default'
	if (preferredChannelId && channels[preferredChannelId]) return preferredChannelId
	if (channels[defaultId]) return defaultId
	const keys = Object.keys(channels)
	return keys[0] || 'default'
}

/**
 * 好友私聊进入/退出（角色或用户）。
 * @param {object | null} peer `null` 退出；否则含 `entityHash`，角色另有 `charname`
 * @returns {void}
 */
export function onEnterFriendChat(peer) {
	cancelScheduledChannelRefresh()
	closeGroupWebSocket()
	if (!peer?.entityHash) {
		store.context.currentGroupId = null
		store.context.currentChannelId = null
		store.context.currentState = null
		updateFriendsHash()
		void setMode('friends')
		return
	}
	store.context.currentMode = 'friends'
	setActiveModeTab('friends')
}

/**
 * 进入好友私聊：与用户 DM 相同，走群频道 + 群 WS；角色回复由服务端按群 char 列表触发。
 * @param {string} groupId 群 ID
 * @param {import('../shared/friendBinding.mjs').FriendBinding} binding 绑定
 * @param {AbortSignal} signal 取消信号
 * @param {string | null | undefined} [channelIdOpt] 目标频道（hash 或调用方指定）
 * @returns {Promise<void>}
 */
async function openFriendGroupChat(groupId, binding, signal, channelIdOpt) {
	throwIfAborted(signal)
	closeGroupWebSocket()

	const state = await getGroupState(groupId)
	throwIfAborted(signal)
	const resolvedChannelId = resolvePrivateChannelId(state, channelIdOpt)
	const displayName = aliasForEntity(binding.entityHash)
		|| binding.displayName || binding.charname || state.groupMeta?.name || groupId

	store.privateGroup.peerEntityHash = binding.entityHash
	store.privateGroup.charname = binding.charname || null
	store.privateGroup.groupId = groupId
	store.context.currentGroupId = groupId
	store.context.currentState = state

	onEnterFriendChat({
		entityHash: binding.entityHash,
		charname: binding.charname,
		displayName,
	})

	const groupNameElement = document.getElementById('group-name-display')
	delete groupNameElement.dataset.i18n
	groupNameElement.textContent = displayName
	if (binding.charname) {
		const details = await getCharDetails(binding.charname)
		throwIfAborted(signal)
		renderCharInfoCardActive(binding.charname, details)
	}
	else
		document.getElementById('info-card-host').innerHTML = ''

	const existingBinding = friendBindingForGroup(groupId)
	if (!friendBindingsEqual(existingBinding, binding))
		await setGroupFriendBinding(groupId, binding)
	throwIfAborted(signal)
	await loadGroups()

	const input = document.getElementById('message-input')
	if (binding.charname) {
		input.dataset.name = binding.charname
		input.setAttribute('data-i18n', 'chat.hub.charChatComposer')
	}
	else {
		delete input.dataset.name
		input.setAttribute('data-i18n', 'chat.hub.friendChatComposer')
	}

	throwIfAborted(signal)
	await selectChannel(resolvedChannelId)
}

/**
 * @param {object} options 选项
 * @param {string} [options.groupId] 群 ID
 * @param {import('../shared/friendBinding.mjs').FriendBinding} [options.binding] 绑定
 * @param {boolean} [options.forceNew] 强制新建群（仅角色）
 * @param {string} [options.channelId] 打开时选中的频道 ID
 * @returns {Promise<void>}
 */
export async function enterFriendChat(options = {}) {
	const binding = options.binding || (options.groupId ? friendBindingForGroup(options.groupId) : null)
	if (!binding?.entityHash) return

	enterFriendChatAbort?.abort()
	const ac = new AbortController()
	enterFriendChatAbort = ac
	const { signal } = ac

	store.friendChatEntering = true
	try {
		throwIfAborted(signal)
		const { clearPrivateGroupState } = await import('./privateGroup.mjs')
		const { setActiveModeTab } = await import('./mode.mjs')
		clearPrivateGroupState()
		setActiveModeTab('friends')
		await mountTemplate(document.getElementById('messages'), 'hub/empty/loading', {})

		throwIfAborted(signal)
		const groupId = await enqueueResolveFriendGroup(
			() => resolveFriendGroupId(binding, options, signal),
			signal,
		)
		if (!groupId) return
		throwIfAborted(signal)
		const channelId = options.channelId || parseHash().channelId || undefined
		await openFriendGroupChat(groupId, binding, signal, channelId)
	}
	catch (error) {
		if (signal.aborted) return
		const err = handleUIError(error, 'chat.hub.createChatFailed')
		await mountTemplate(document.getElementById('messages'), 'hub/empty/error', {
			i18nKey: 'chat.hub.createChatFailed',
			errorMessage: err.message,
		})
	}
	finally {
		if (enterFriendChatAbort === ac) {
			enterFriendChatAbort = null
			store.friendChatEntering = false
		}
	}
}

/**
 * @param {{ type: 'char' | 'user', id?: string, displayName?: string, pubKeyHex?: string | null, entityHash?: string | null }} entity 实体
 * @returns {Promise<void>}
 */
export async function dispatchFriendChat(entity) {
	if (entity.type === 'char' && entity.id) {
		const entityHash = entity.entityHash && isEntityHash128(entity.entityHash)
			? String(entity.entityHash).toLowerCase()
			: await (await import('./entityResolve.mjs')).charAgentEntityHash(entity.id)
		if (!entityHash) {
			showToastI18n('error', 'chat.hub.noUsername')
			return
		}
		await enterFriendChat({
			binding: buildCharFriendBinding(entityHash, entity.id, entity.displayName),
		})
		return
	}
	if (entity.type !== 'user') return

	const fed = await getFederationSettings()
	const myPubKeyHex = String(fed?.activePubKeyHex || '').trim().toLowerCase()
	if (!isHex64(myPubKeyHex)) {
		showToastI18n('warning', 'chat.hub.profilePopup.noFedIdentity')
		return
	}
	const peerHex = String(entity.pubKeyHex || '').trim().toLowerCase()
	if (!isHex64(peerHex) && !isEntityHash128(entity.entityHash)) {
		showToastI18n('warning', 'chat.hub.profilePopup.peerNoIdentity')
		return
	}
	const data = await createDirectMessageByPubKeys(myPubKeyHex, peerHex)
	const binding = friendBindingForGroup(data.groupId)
		|| await buildUserFriendBinding({
			entityHash: entity.entityHash,
			pubKeyHex: peerHex,
			displayName: entity.displayName,
		})
	await enterFriendChat({ groupId: data.groupId, binding })
}
