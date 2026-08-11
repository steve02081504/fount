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
import { buildUserFriendBinding, charFriendBindingInput, normalizeFriendBinding } from '../shared/friendBinding.mjs'
import { getFederationSettings } from '../src/endpoints/federationSettings.mjs'
import { addGroupChar, createFriendGroup, getGroupState, listGroupChars } from '../src/endpoints/groupCore.mjs'
import { createDirectMessageByPubKeys } from '../src/endpoints/groupDm.mjs'
import { setGroupFriendBinding } from '../src/endpoints/groupFriendBinding.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'

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
	if (signal?.aborted)
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
	resolveFriendGroupChain = run.catch(() => { })
	return run
}

/**
 * 查找已绑定该角色的好友群（entityHash 或本地 charname）。
 * @param {{ entityHash?: string, charname?: string }} binding 绑定
 * @returns {Promise<string|null>} 群 ID
 */
async function findExistingFriendGroup(binding) {
	await loadGroups()
	const entityHash = String(binding.entityHash || '').trim().toLowerCase()
	const charKey = String(binding.charname || '').trim()
	const matches = store.sidebar.groups.filter(g => {
		const fb = g.friendBinding
		if (!fb) return false
		if (entityHash && fb.entityHash === entityHash) return true
		return !!(charKey && String(fb.charname || '').trim() === charKey)
	})
	if (!matches.length) return null
	matches.sort((a, b) => new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0))
	return matches[0].groupId ?? null
}

/**
 * 确保群上已挂载角色 part。
 * @param {string} groupId 群 ID
 * @param {string} charname 角色名
 * @param {AbortSignal} [signal] 取消信号
 * @returns {Promise<void>}
 */
async function ensureCharOnGroup(groupId, charname, signal) {
	throwIfAborted(signal)
	const chars = await listGroupChars(groupId, signal)
	throwIfAborted(signal)
	if (chars.includes(charname)) return
	await addGroupChar(groupId, { charname, deferGreeting: true }, signal)
	throwIfAborted(signal)
}

/**
 * 解析或新建好友群（角色需 addchar；用户 DM 由调用方传入 groupId）。
 * @param {{ entityHash?: string, charname?: string, displayName?: string }} binding 绑定（可仅 charname，建群时后端物化）
 * @param {{ groupId?: string, forceNew?: boolean, signal?: AbortSignal }} options 选项
 * @returns {Promise<{ groupId: string, binding: import('../shared/friendBinding.mjs').FriendBinding } | null>} 群与规范化绑定
 */
async function resolveFriendGroupId(binding, options) {
	const { signal } = options
	let groupId = options.forceNew ? undefined : options.groupId
	let resolved = normalizeFriendBinding(binding)
	if (groupId) {
		if (!resolved) {
			const existing = friendBindingForGroup(groupId)
			resolved = normalizeFriendBinding(existing) || normalizeFriendBinding({
				...binding,
				entityHash: existing?.entityHash,
			})
		}
		if (!resolved) return null
		if (resolved.charname)
			await ensureCharOnGroup(groupId, resolved.charname, signal)
		return { groupId, binding: resolved }
	}
	if (!groupId && !options.forceNew) {
		const fromHash = parseHash().groupId
		if (fromHash) groupId = fromHash
	}
	if (!groupId && !options.forceNew)
		groupId = await findExistingFriendGroup(binding)

	throwIfAborted(signal)
	if (!groupId) {
		const payload = await createFriendGroup({
			friendBinding: binding,
			...options.forceNew ? { forceNew: true } : {},
		}, signal)
		throwIfAborted(signal)
		groupId = payload.groupId
		resolved = normalizeFriendBinding(payload.friendBinding) || resolved
	}
	else if (!resolved) {
		const existing = friendBindingForGroup(groupId)
		resolved = normalizeFriendBinding(existing) || normalizeFriendBinding({
			...binding,
			entityHash: existing?.entityHash,
		})
	}
	if (!resolved?.entityHash) return null

	if (resolved.charname)
		await ensureCharOnGroup(groupId, resolved.charname, signal)

	return { groupId, binding: resolved }
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
		input.setAttribute('data-i18n', 'chat.hub.char.chat.composer')
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
 * @param {{ entityHash?: string, charname?: string, displayName?: string }} [options.binding] 绑定（角色可仅 charname）
 * @param {boolean} [options.forceNew] 强制新建群（仅角色）
 * @param {string} [options.channelId] 打开时选中的频道 ID
 * @returns {Promise<void>}
 */
export async function enterFriendChat(options = {}) {
	const binding = options.binding || (options.groupId ? friendBindingForGroup(options.groupId) : null)
	if (!binding?.entityHash && !binding?.charname) return

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
		const resolved = await enqueueResolveFriendGroup(
			() => resolveFriendGroupId(binding, { ...options, signal }),
			signal,
		)
		if (!resolved) return
		throwIfAborted(signal)
		const channelId = options.channelId || parseHash().channelId || undefined
		await openFriendGroupChat(resolved.groupId, resolved.binding, signal, channelId)
	}
	catch (error) {
		if (signal.aborted) return
		const err = handleError('chat.hub.createChatFailed')(error)
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
		await enterFriendChat({
			binding: charFriendBindingInput(entity.id, entity.displayName),
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
	let peerHex = String(entity.pubKeyHex || '').trim().toLowerCase()
	const entityHash = String(entity.entityHash || '').trim().toLowerCase()
	if (!isHex64(peerHex) && isEntityHash128(entityHash)) {
		const { getEntityProfile } = await import('../src/endpoints/entities.mjs')
		const data = await getEntityProfile(entityHash, undefined, { forceRemote: true }).catch(() => null)
		peerHex = String(data?.profile?.activePubKeyHex || '').trim().toLowerCase()
	}
	if (!isHex64(peerHex)) {
		showToastI18n('warning', 'chat.hub.profilePopup.peerNoIdentity')
		return
	}
	const data = await createDirectMessageByPubKeys(myPubKeyHex, peerHex)
	const binding = friendBindingForGroup(data.groupId)
		|| await buildUserFriendBinding({
			entityHash: isEntityHash128(entityHash) ? entityHash : undefined,
			pubKeyHex: peerHex,
			displayName: entity.displayName,
		})
	await enterFriendChat({ groupId: data.groupId, binding })
}
