/**
 * 【文件】public/hub/friendsList.mjs
 * 【职责】好友模式侧栏：拉取好友列表 API、渲染好友列与角色/用户会话入口。
 * 【原理】`renderFriendsColumn` 填充 `#hub-friends-list`；支持删除好友、重启私聊等行内操作；点击好友后由 `friendChat`/`chat.enterPrivateGroup` 加载消息。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】好友模式对应 `#friends`，由 `mode.setMode('friends')` 写入；../../../../scripts/i18n、../../../../scripts/template、../../../../scripts/toast、chat、core/domUtils、core/state、friendBindings、friendChat。
 */
import { isHex64 } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'

import { mountTemplate } from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { confirmI18n, geti18n } from '../../../../scripts/i18n/index.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { setEntityAlias } from '../shared/aliases.mjs'
import { formatEntityAtId } from '../shared/entityHash.mjs'

import { getCharDetails, renderCharInfoCard } from './charCard.mjs'
import { avatarColor, avatarInitial, avatarTextColor } from './core/domUtils.mjs'
import { hubStore } from './core/state.mjs'
import { resolveFriendBinding } from './friendBindings.mjs'
import { dispatchFriendChat, enterFriendChat, onEnterFriendChat } from './friendChat.mjs'
import { restartPrivateGroup } from './privateGroup.mjs'
import { loadGroups } from './serverBar.mjs'

/**
 * @typedef {object} FriendRow
 * @property {string} groupId
 * @property {string} key
 * @property {string} displayName
 * @property {string} [charname]
 * @property {import('../shared/friendBinding.mjs').FriendBinding} binding
 * @property {object} session
 */

/**
 * @returns {Promise<FriendRow[]>} 已绑定好友私聊的侧栏行
 */
export async function loadFriendsList() {
	await loadGroups()
	/** @type {Map<string, FriendRow>} */
	const byEntityHash = new Map()
	for (const group of hubStore.sidebar.groups) {
		const binding = resolveFriendBinding(group)
		if (!binding) continue
		const row = {
			groupId: group.groupId,
			key: binding.entityHash,
			displayName: binding.displayName || binding.charname || group.name || group.groupId,
			charname: binding.charname,
			binding,
			session: {
				groupId: group.groupId,
				lastMessageContent: '',
				lastMessageTime: group.lastMessageTime,
			},
		}
		const prev = byEntityHash.get(binding.entityHash)
		if (!prev) {
			byEntityHash.set(binding.entityHash, row)
			continue
		}
		const prevTime = new Date(prev.session.lastMessageTime || 0).getTime()
		const nextTime = new Date(row.session.lastMessageTime || 0).getTime()
		if (nextTime >= prevTime)
			byEntityHash.set(binding.entityHash, row)
	}
	const rows = [...byEntityHash.values()]
	rows.sort((a, b) => {
		const ta = new Date(a.session.lastMessageTime || 0).getTime()
		const tb = new Date(b.session.lastMessageTime || 0).getTime()
		if (ta !== tb) return tb - ta
		return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
	})
	return rows
}

/**
 * @param {FriendRow} friend 好友行
 * @param {object|null} details 角色详情
 * @returns {Promise<object>} `chars_column` 单项模板数据
 */
async function friendRowTemplateData(friend, details) {
	const rawDesc = String(friend.session.lastMessageContent || '').trim()
	const subtitle = rawDesc.length > 52 ? `${rawDesc.slice(0, 52)}…` : rawDesc
	const active = hubStore.privateGroup.groupId === friend.groupId
	if (!friend.charname)
		return {
			kind: 'dm',
			name: friend.groupId,
			groupId: friend.groupId,
			displayName: friend.displayName,
			subtitle,
			activeClass: active ? ' active' : '',
			avatarBg: avatarColor(friend.key),
			avatarTextColor: avatarTextColor(friend.key),
			avatarInner: escapeHtml(avatarInitial(friend.displayName)),
		}

	const info = details?.info || {}
	const avatarUrl = info.avatar || details?.avatar || ''
	const displayName = info.name || friend.displayName
	return {
		kind: 'char',
		name: friend.charname,
		groupId: friend.groupId,
		displayName,
		subtitle,
		activeClass: active ? ' active' : '',
		avatarBg: avatarColor(friend.key),
		avatarTextColor: avatarTextColor(friend.key),
		avatarInner: avatarUrl
			? `<img src="${escapeHtml(avatarUrl)}" alt="" class="hub-char-list-avatar-img" />`
			: escapeHtml(avatarInitial(friend.charname)),
	}
}

/**
 * 删除指定好友会话（永久移除消息记录）。
 * @param {FriendRow} friend 好友行
 * @returns {Promise<void>}
 */
async function deleteFriendSession(friend) {
	const name = friend.charname || friend.displayName || friend.groupId
	if (!confirmI18n('chat.hub.deleteSessionConfirm', { name })) return
	try {
		const r = await fetch(
			`/api/parts/shells:chat/sessions/${encodeURIComponent(friend.groupId)}`,
			{ method: 'DELETE', credentials: 'include' },
		)
		if (!r.ok) {
			const data = await r.json().catch(() => ({}))
			throw new Error(data.error || `HTTP ${r.status}`)
		}
		showToastI18n('success', 'chat.hub.sessionDeleted')
		if (hubStore.privateGroup.groupId === friend.groupId) {
			const { clearPrivateGroupState } = await import('./privateGroup.mjs')
			clearPrivateGroupState()
			onEnterFriendChat(null)
		}
		await loadGroups()
		const friends = await loadFriendsList()
		await renderFriendsColumn(friends)
	}
	catch (err) {
		showToastI18n('error', 'chat.hub.sessionDeleteFailed', { error: err.message })
	}
}

/**
 * @param {MouseEvent} event 指针事件
 * @param {FriendRow} friend 好友行
 * @returns {void}
 */
function showFriendContextMenu(event, friend) {
	event.preventDefault()
	document.getElementById('hub-friend-context-menu')?.remove()

	const menu = document.createElement('ul')
	menu.id = 'hub-friend-context-menu'
	menu.className = 'menu menu-sm bg-base-100 rounded-box shadow-lg border border-base-300 p-1 z-50'
	const menuWidth = 192
	const left = Math.min(event.clientX, window.innerWidth - menuWidth - 8)
	const top = Math.min(event.clientY, window.innerHeight - 80)
	menu.style.cssText = `position:fixed;left:${Math.max(8, left)}px;top:${Math.max(8, top)}px;min-width:${menuWidth}px;`

	const items = []
	if (friend.charname)
		items.push('<li><button type="button" class="w-full text-left" data-action="new-chat" data-i18n="chat.hub.friendsContextNewChat"></button></li>')
	items.push('<li><button type="button" class="w-full text-left text-error" data-action="delete-session" data-i18n="chat.hub.deleteSession"></button></li>')
	menu.innerHTML = items.join('')
	document.body.appendChild(menu)

	/** @returns {void} */
	const dismiss = () => {
		menu.remove()
		document.removeEventListener('click', dismiss, true)
		document.removeEventListener('keydown', onKey, true)
	}
	/** @param {KeyboardEvent} e 键盘事件 */
	const onKey = (e) => {
		if (e.key === 'Escape') dismiss()
	}
	setTimeout(() => {
		document.addEventListener('click', dismiss, true)
		document.addEventListener('keydown', onKey, true)
	}, 0)

	menu.querySelector('[data-action="new-chat"]')?.addEventListener('click', () => {
		dismiss()
		void (async () => {
			if (!confirmI18n('chat.hub.friendsRestartConfirm', { name: friend.charname }))
				return
			try {
				await restartPrivateGroup(friend.charname, friend.groupId)
				showToastI18n('success', 'chat.hub.friendsRestartOk')
			}
			catch (err) {
				showToastI18n('error', 'chat.hub.friendsRestartFailed', { error: err.message })
			}
		})()
	})

	menu.querySelector('[data-action="delete-session"]')?.addEventListener('click', () => {
		dismiss()
		void deleteFriendSession(friend)
	})
}

/**
 * @param {FriendRow[]} friends 好友行
 * @returns {Promise<void>}
 */
export async function renderFriendsColumn(friends) {
	const header = document.getElementById('hub-group-name-display')
	const container = document.getElementById('hub-channel-list')
	header.dataset.i18n = 'chat.hub.friendsTag'

	const wrap = document.createElement('div')
	wrap.className = 'hub-friends-wrap flex flex-col gap-2 h-full min-h-0'
	wrap.innerHTML = `
		<div class="hub-friends-search px-2 pt-1">
			<input type="search" id="hub-friends-search-input" class="input input-bordered input-sm w-full" autocomplete="off" data-i18n="chat.hub.friendsSearchPlaceholder" placeholder="${escapeHtml(geti18n('chat.hub.friendsSearchPlaceholder'))}" />
			<div id="hub-friends-search-results" class="hub-friends-search-results mt-2 space-y-1 max-h-48 overflow-y-auto hidden"></div>
		</div>
		<div id="hub-friends-list-body" class="hub-friends-list-body min-h-0 flex-1 overflow-y-auto"></div>
	`
	container.replaceChildren(wrap)
	const body = wrap.querySelector('#hub-friends-list-body')
	const searchInput = wrap.querySelector('#hub-friends-search-input')
	const searchResults = wrap.querySelector('#hub-friends-search-results')

	let searchTimer = 0
	searchInput?.addEventListener('input', () => {
		clearTimeout(searchTimer)
		searchTimer = setTimeout(() => { void runFriendsEntitySearch(searchInput, searchResults) }, 280)
	})
	searchInput?.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') {
			clearTimeout(searchTimer)
			void runFriendsEntitySearch(searchInput, searchResults)
		}
	})

	if (!friends.length) {
		await mountTemplate(body, 'hub/nav/side_muted', { i18nKey: 'chat.hub.noFriends' })
		return
	}
	const charFriends = friends.filter(f => f.charname)
	const detailsList = await Promise.all(charFriends.map(f => getCharDetails(f.charname)))
	const detailsByChar = new Map(charFriends.map((f, i) => [f.charname, detailsList[i]]))
	const rows = await Promise.all(friends.map(f =>
		friendRowTemplateData(f, f.charname ? detailsByChar.get(f.charname) : null),
	))
	await mountTemplate(body, 'hub/mode/chars_column', {
		count: String(friends.length),
		countI18nKey: 'chat.hub.friendsCount',
		items: rows,
	})
	body.querySelectorAll('.hub-char-list-item').forEach((el) => {
		const { groupId } = el.dataset
		const row = friends.find(f => f.groupId === groupId)
		if (!row) return
		el.addEventListener('click', () => void enterFriendChat({ groupId: row.groupId, binding: row.binding }))
		el.addEventListener('contextmenu', (event) => showFriendContextMenu(event, row))
		if (row.charname)
			el.addEventListener('mouseenter', async () => {
				if (hubStore.privateGroup.groupId) return
				const details = await getCharDetails(row.charname)
				await renderCharInfoCard(row.charname, details)
			})
	})
}

/**
 * @param {HTMLInputElement} input 搜索框
 * @param {HTMLElement} resultsHost 结果容器
 * @returns {Promise<void>}
 */
async function runFriendsEntitySearch(input, resultsHost) {
	if (!(input instanceof HTMLInputElement) || !(resultsHost instanceof HTMLElement)) return
	const q = input.value.trim()
	if (q.length < 2) {
		resultsHost.classList.add('hidden')
		resultsHost.replaceChildren()
		if (q.length === 1) {
			const hint = document.createElement('p')
			hint.className = 'text-xs opacity-60 px-1'
			hint.textContent = geti18n('chat.hub.friendsSearchTooShort')
			resultsHost.appendChild(hint)
			resultsHost.classList.remove('hidden')
		}
		return
	}
	const response = await fetch(`/api/parts/shells:chat/entities/search?q=${encodeURIComponent(q)}`, {
		credentials: 'include',
	})
	const data = await response.json().catch(() => ({}))
	if (!response.ok) {
		showToastI18n('error', 'chat.hub.createChatFailed', { error: data.error || `HTTP ${response.status}` })
		return
	}
	const entities = data.entities || []
	resultsHost.replaceChildren()
	resultsHost.classList.remove('hidden')
	if (!entities.length) {
		const empty = document.createElement('p')
		empty.className = 'text-xs opacity-60 px-1'
		empty.textContent = geti18n('chat.hub.friendsSearchEmpty')
		resultsHost.appendChild(empty)
		return
	}
	for (const entity of entities) {
		const row = document.createElement('div')
		row.className = 'flex items-center gap-2 rounded-box bg-base-200 px-2 py-1'
		const handle = formatEntityAtId(entity.entityHash, { handle: entity.handle })
		const label = entity.alias || entity.name || handle
		row.innerHTML = `
			<div class="min-w-0 flex-1">
				<div class="text-sm truncate">${escapeHtml(label)}</div>
				<div class="text-xs opacity-60 truncate">${escapeHtml(handle)}</div>
			</div>
			<button type="button" class="btn btn-ghost btn-xs" data-pin>${escapeHtml(geti18n('chat.hub.friendsSearchPin'))}</button>
			<button type="button" class="btn btn-primary btn-xs" data-dm>${escapeHtml(geti18n('chat.hub.friendsSearchDm'))}</button>
		`
		row.querySelector('[data-pin]')?.addEventListener('click', () => {
			void (async () => {
				const next = prompt(geti18n('chat.hub.profilePopup.setAliasPrompt', { name: label }), entity.alias || entity.handle || entity.name || '')
				if (next == null) return
				await setEntityAlias(entity.entityHash, next)
				showToastI18n('success', 'chat.hub.memberContext.aliasSaved')
			})()
		})
		row.querySelector('[data-dm]')?.addEventListener('click', () => {
			void (async () => {
				const pubKeyHex = String(entity.activePubKeyHex || '').trim().toLowerCase()
				if (!isHex64(pubKeyHex)) {
					showToastI18n('warning', 'chat.hub.profilePopup.peerNoIdentity')
					return
				}
				if (entity.handle || entity.name)
					await setEntityAlias(entity.entityHash, entity.alias || entity.handle || entity.name).catch(() => {})
				await dispatchFriendChat({
					type: 'user',
					displayName: label,
					pubKeyHex,
					entityHash: entity.entityHash,
				})
			})()
		})
		resultsHost.appendChild(row)
	}
}
