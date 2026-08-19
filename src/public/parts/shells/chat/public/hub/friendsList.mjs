/**
 * 【文件】public/hub/friendsList.mjs
 * 【职责】好友模式侧栏：拉取好友列表 API、渲染好友列与角色/用户会话入口。
 * 【原理】`renderFriendsColumn` 填充 `#friends-list`；支持删除好友、重启私聊等行内操作；点击好友后由 `friendChat`/`chat.enterPrivateGroup` 加载消息。搜索同时覆盖本地角色 part 与网络实体。悬停走共享 `entityProfileHoverCard`（与消息一致），不用 native `title` tip / 主栏 `renderCharInfoCard` 预览。
 * 【数据结构】store（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】好友模式对应 `#friends`，由 `mode.setMode('friends')` 写入；/scripts/i18n、/scripts/features/template、/scripts/features/toast、chat、core/domUtils、core/state、friendBindings、friendChat。
 */
import { isHex64 } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'

import { getAllCachedPartDetails, getPartList } from '/scripts/endpoints/parts.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { confirmI18n, geti18n } from '/scripts/i18n/index.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { escapeRegExp } from '/scripts/lib/regex.mjs'
import { aliasForEntity, setEntityAlias } from '../shared/aliases.mjs'
import { formatEntityAtId, isEntityHash128 } from '../shared/entityHash.mjs'
import { bindEntityProfileHoverAnchor } from '../shared/entityProfileHoverCard.mjs'
import { displayProfileAvatar, listAvatarTemplateFields } from '../shared/hashAvatar.mjs'
import { resolveDisplayName } from '../shared/nameResolve.mjs'
import { searchEntities } from '../src/endpoints/entities.mjs'
import { deleteSession } from '../src/endpoints/groupCore.mjs'
import { mountTemplate, renderTemplate } from '../src/templates.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { promptText } from '/scripts/features/promptDialog.mjs'

import { getCharDetails } from './charCard.mjs'
import { bindDismissOnDocumentInteraction } from '/scripts/components/contextMenuDismiss.mjs'
import { positionContextMenu } from '/scripts/components/positionContextMenu.mjs'
import { store } from './core/state.mjs'
import { charAgentEntityHash } from './entityResolve.mjs'
import { resolveFriendBinding } from './friendBindings.mjs'
import { dispatchFriendChat, enterFriendChat, onEnterFriendChat } from './friendChat.mjs'
import { fetchAuthorProfile } from './presence.mjs'
import { restartPrivateGroup } from './privateGroup.mjs'
import { loadGroups } from './serverBar.mjs'

/**
 * 好友侧栏行。
 * @typedef {object} FriendRow
 * @property {string} groupId 私聊群 ID
 * @property {string} key 对端 entityHash 或去重键
 * @property {string} displayName 侧栏展示名
 * @property {string} [charname] 本地角色 part 名（用户 DM 时省略）
 * @property {import('../shared/friendBinding.mjs').FriendBinding} binding 好友绑定
 * @property {object} session 侧栏会话摘要（最后消息等）
 */

/**
 * 好友搜索命中项。
 * @typedef {object} FriendsSearchHit
 * @property {'char' | 'user'} kind 命中类型：本地角色或网络用户
 * @property {string} label 主展示文案
 * @property {string} subtitle 副标题（handle / part 名等）
 * @property {string} [charname] 角色 part 名
 * @property {string} [entityHash] 128 位 entityHash
 * @property {string} [handle] 联邦 handle
 * @property {string} [alias] 本地别名
 * @property {string} [name] 资料名
 * @property {string} [activePubKeyHex] 活跃公钥 hex
 * @property {string} [avatar] 头像 URL
 */

/**
 * 构建好友悬停卡 `paintOptions`。
 * @returns {object} 悬停卡 paintOptions
 */
function friendHoverPaintOptions() {
	return {
		selfEntityHash: store.viewer?.viewerEntityHash,
		nodeHash: store.viewer?.nodeHash,
		viewerOwnerEntityHash: store.viewer?.ownerEntityHash,
	}
}

/**
 * 为好友行绑定实体资料悬停卡。
 * @param {HTMLElement} el 锚点
 * @param {{ entityHash?: string, displayName: string, groupId?: string, charname?: string }} target 目标
 * @returns {void}
 */
function bindFriendProfileHover(el, target) {
	bindEntityProfileHoverAnchor(el, async () => {
		let entityHash = target.entityHash || ''
		if (!isEntityHash128(entityHash) && target.charname)
			entityHash = await charAgentEntityHash(target.charname) || ''
		if (!isEntityHash128(entityHash)) return null
		return {
			cacheKey: entityHash,
			entityHash,
			displayName: target.displayName,
			groupId: target.groupId || undefined,
			wireActions: true,
			entity: {
				entityHash,
				charname: target.charname || null,
				pubKeyHex: null,
				pubKeyHash: null,
				displayName: target.displayName,
			},
			paintOptions: friendHoverPaintOptions(),
		}
	})
}

/**
 * @returns {Promise<FriendRow[]>} 已绑定好友私聊的侧栏行
 */
export async function loadFriendsList() {
	await loadGroups()
	/** @type {Map<string, FriendRow>} */
	const byEntityHash = new Map()
	for (const group of store.sidebar.groups) {
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
 * 组装单条好友行的 `chars_column` 模板数据。
 * @param {FriendRow} friend 好友行
 * @param {object|null} details 角色详情
 * @returns {Promise<object>} `chars_column` 单项模板数据
 */
async function friendRowTemplateData(friend, details) {
	const rawDesc = friend.session.lastMessageContent || ''
	const subtitle = rawDesc.length > 52 ? `${rawDesc.slice(0, 52)}…` : rawDesc
	const active = store.privateGroup.groupId === friend.groupId
	const displayName = resolveDisplayName({
		entityHash: friend.key,
		alias: aliasForEntity(friend.key),
		profileName: friend.charname
			? details?.info?.name || friend.displayName
			: friend.displayName,
		fallbackLabel: friend.charname || friend.groupId,
	})
	if (!friend.charname) {
		const seed = friend.key || friend.groupId
		return {
			kind: 'dm',
			name: friend.groupId,
			groupId: friend.groupId,
			entityHash: isEntityHash128(friend.key) ? friend.key : '',
			displayName,
			subtitle,
			activeClass: active ? ' active' : '',
			...listAvatarTemplateFields(seed, displayName),
		}
	}

	const entityHash = friend.key || await charAgentEntityHash(friend.charname)
	const profile = entityHash
		? await fetchAuthorProfile(entityHash)
		: null
	const resolvedName = resolveDisplayName({
		entityHash: entityHash || friend.key,
		alias: aliasForEntity(entityHash || friend.key),
		profileName: profile?.name || details?.info?.name || friend.displayName,
		fallbackLabel: friend.charname || friend.groupId,
	})
	return {
		kind: 'char',
		name: friend.charname,
		groupId: friend.groupId,
		entityHash: entityHash || '',
		displayName: resolvedName,
		subtitle,
		activeClass: active ? ' active' : '',
		...listAvatarTemplateFields(entityHash || friend.key, resolvedName, displayProfileAvatar(profile)),
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
		await deleteSession(friend.groupId)
		showToastI18n('success', 'chat.hub.session.deleted')
		if (store.privateGroup.groupId === friend.groupId) {
			const { clearPrivateGroupState } = await import('./privateGroup.mjs')
			clearPrivateGroupState()
			onEnterFriendChat(null)
		}
		await loadGroups()
		const friends = await loadFriendsList()
		await renderFriendsColumn(friends)
	}
	catch (err) {
		showToastI18n('error', 'chat.hub.session.deleteFailed', { error: err.message })
	}
}

/**
 * 显示好友行右键菜单（新会话 / 删除）。
 * @param {MouseEvent} event 指针事件
 * @param {FriendRow} friend 好友行
 * @returns {void}
 */
function showFriendContextMenu(event, friend) {
	event.preventDefault()
	document.getElementById('friend-context-menu')?.remove()

	const menu = document.createElement('ul')
	menu.id = 'friend-context-menu'
	menu.className = 'menu menu-sm bg-base-100 rounded-box shadow-lg border border-base-300 p-1 z-50'

	const items = []
	if (friend.charname)
		items.push('<li><button type="button" class="w-full text-left" data-action="new-chat" data-i18n="chat.hub.friends.contextNewChat"></button></li>')
	items.push('<li><button type="button" class="w-full text-left text-error" data-action="delete-session" data-i18n="chat.hub.deleteSession"></button></li>')
	menu.innerHTML = items.join('')
	document.body.appendChild(menu)
	positionContextMenu(menu, { x: event.clientX, y: event.clientY, minWidth: 192 })

	/** @returns {void} */
	const dismiss = () => {
		menu.remove()
		document.removeEventListener('keydown', onKey, true)
	}
	/** @param {KeyboardEvent} e 键盘事件 */
	const onKey = (e) => {
		if (e.key === 'Escape') closeOnce()
	}
	const closeOnce = bindDismissOnDocumentInteraction(dismiss)
	document.addEventListener('keydown', onKey, true)

	menu.querySelector('[data-action="new-chat"]')?.addEventListener('click', () => {
		closeOnce()
		void (async () => {
			if (!confirmI18n('chat.hub.friends.restartConfirm', { name: friend.charname }))
				return
			try {
				await restartPrivateGroup(friend.charname, friend.groupId)
				showToastI18n('success', 'chat.hub.friends.restartOk')
			}
			catch (err) {
				showToastI18n('error', 'chat.hub.friends.restartFailed', { error: err.message })
			}
		})()
	})

	menu.querySelector('[data-action="delete-session"]')?.addEventListener('click', () => {
		closeOnce()
		void deleteFriendSession(friend)
	})
}

/**
 * 渲染好友模式侧栏列表与搜索区。
 * @param {FriendRow[]} friends 好友行
 * @returns {Promise<void>}
 */
export async function renderFriendsColumn(friends) {
	const header = document.getElementById('group-name-display')
	const container = document.getElementById('channel-list')
	header.dataset.i18n = 'chat.hub.friends.tag'

	const wrap = document.createElement('div')
	wrap.className = 'friends-wrap flex flex-col gap-2 h-full min-h-0'
	wrap.appendChild(await renderTemplate('hub/friends/search_wrap', {}))
	container.replaceChildren(wrap)
	const body = wrap.querySelector('#friends-list-body')
	const searchInput = wrap.querySelector('#friends-search-input')
	const searchResults = wrap.querySelector('#friends-search-results')

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
		await mountTemplate(body, 'hub/nav/side_muted', { i18nKey: 'chat.hub.no.friends' })
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
		countI18nKey: 'chat.hub.friends.count',
		items: rows,
	})
	body.querySelectorAll('.char-list-item').forEach((el) => {
		const { groupId } = el.dataset
		const row = friends.find(f => f.groupId === groupId)
		if (!row) return
		el.addEventListener('click', () => void enterFriendChat({ groupId: row.groupId, binding: row.binding }))
		el.addEventListener('contextmenu', (event) => showFriendContextMenu(event, row))
		bindFriendProfileHover(el, {
			entityHash: row.key,
			displayName: row.displayName,
			groupId: row.groupId,
			charname: row.charname,
		})
	})
}

/**
 * 按 part 名 / 展示名搜本机角色。
 * @param {string} q 搜索词
 * @returns {Promise<FriendsSearchHit[]>} 本地角色命中
 */
async function searchLocalChars(q) {
	const nq = q.trim()
	if (nq.length < 2) return []
	const re = new RegExp(escapeRegExp(nq), 'iu')
	const [names, cached] = await Promise.all([
		getPartList('chars').catch(() => []),
		getAllCachedPartDetails('chars').catch(() => ({})),
	])
	const detailsMap = cached?.cachedDetails || {}
	/** @type {FriendsSearchHit[]} */
	const hits = []
	for (const charname of Array.isArray(names) ? names : []) {
		if (!charname) continue
		const details = detailsMap[charname] || null
		const displayName = String(details?.info?.name || '').trim()
		if (!re.test(charname) && !re.test(displayName)) continue
		hits.push({
			kind: 'char',
			charname,
			label: displayName || charname,
			subtitle: displayName && displayName !== charname ? charname : geti18n('chat.hub.friends.search.localChar'),
			avatar: String(details?.info?.avatar || '').trim() || undefined,
		})
		if (hits.length >= 20) break
	}
	return hits
}

/**
 * 为搜索命中补齐 entityHash / 头像（char 优先拉 profile）。
 * @param {FriendsSearchHit} hit 命中
 * @returns {Promise<FriendsSearchHit>} 补齐后的命中
 */
async function enrichFriendsSearchHit(hit) {
	if (hit.kind === 'char' && hit.charname && !isEntityHash128(hit.entityHash))
		hit.entityHash = await charAgentEntityHash(hit.charname) || hit.entityHash
	if (hit.kind === 'char' && isEntityHash128(hit.entityHash) && !hit.avatar) {
		const profile = await fetchAuthorProfile(hit.entityHash)
		hit.avatar = displayProfileAvatar(profile) || hit.avatar
		if (profile?.name && !hit.name) hit.name = profile.name
	}
	return hit
}

/**
 * 将单条搜索命中渲染为可点击行并挂载操作。
 * @param {FriendsSearchHit} hit 搜索命中
 * @param {HTMLElement} resultsHost 结果容器
 * @returns {Promise<void>}
 */
async function appendFriendsSearchHit(hit, resultsHost) {
	const isChar = hit.kind === 'char'
	const seed = hit.entityHash || hit.charname || hit.label
	const row = await renderTemplate('hub/friends/search_row', {
		label: escapeHtml(hit.label),
		handle: escapeHtml(hit.subtitle),
		showPin: isChar ? '' : '1',
		actionI18n: isChar ? 'chat.hub.friends.search.chat' : 'chat.hub.friends.search.dm',
		...listAvatarTemplateFields(seed, hit.label, isChar ? hit.avatar : ''),
	})
	if (isChar || isEntityHash128(hit.entityHash))
		bindFriendProfileHover(row, {
			entityHash: hit.entityHash,
			displayName: hit.label,
			charname: hit.charname,
		})
	if (!isChar)
		row.querySelector('[data-pin]')?.addEventListener('click', () => {
			void (async () => {
				const next = await promptText(
					'chat.hub.profilePopup.setAliasPrompt',
					hit.alias || '',
					{ name: hit.label },
				)
				if (next == null) return
				await setEntityAlias(hit.entityHash, next)
				showToastI18n('success', 'chat.hub.member.context.aliasSaved')
				hit.alias = next
				hit.label = resolveDisplayName({
					entityHash: hit.entityHash,
					alias: next,
					profileName: hit.name,
					fallbackLabel: hit.handle || hit.entityHash,
				})
				const labelEl = row.querySelector('[data-label]')
				if (labelEl) labelEl.textContent = hit.label
			})().catch(error => {
				showToastI18n('error', 'chat.hub.operationFailed', { error: error.message })
			})
		})
	row.querySelector('[data-dm]')?.addEventListener('click', () => {
		void (async () => {
			if (isChar) {
				await dispatchFriendChat({
					type: 'char',
					id: hit.charname,
					displayName: hit.label,
					entityHash: hit.entityHash,
				})
				return
			}
			const pubKeyHex = hit.activePubKeyHex || ''
			if (!isHex64(pubKeyHex)) {
				showToastI18n('warning', 'chat.hub.profilePopup.peerNoIdentity')
				return
			}
			if (hit.handle || hit.name)
				await setEntityAlias(hit.entityHash, hit.alias || hit.handle || hit.name)
					.catch(handleError('chat.hub.operationFailed'))
			await dispatchFriendChat({
				type: 'user',
				displayName: hit.label,
				pubKeyHex,
				entityHash: hit.entityHash,
			})
		})()
	})
	resultsHost.appendChild(row)
}

/**
 * 执行好友搜索（本地角色 + 网络实体）并刷新结果区。
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
			resultsHost.appendChild(await renderTemplate('hub/friends/search_hint', {
				i18nKey: 'chat.hub.friends.search.tooShort',
			}))
			resultsHost.classList.remove('hidden')
		}
		return
	}

	const [localChars, data] = await Promise.all([
		searchLocalChars(q),
		searchEntities(q).catch(error => {
			handleError('chat.hub.createChatFailed')(error)
			return null
		}),
	])
	if (!data) return

	const seenChars = new Set(localChars.map(h => h.charname))
	/** @type {FriendsSearchHit[]} */
	const hits = [...localChars]
	for (const entity of data.entities || []) {
		const { charPartName } = entity
		if (charPartName) {
			if (seenChars.has(charPartName)) continue
			seenChars.add(charPartName)
			const handle = formatEntityAtId(entity.entityHash, { handle: entity.handle })
			hits.push({
				kind: 'char',
				charname: charPartName,
				entityHash: entity.entityHash,
				label: entity.alias || entity.name || charPartName,
				subtitle: handle,
			})
			continue
		}
		const handle = formatEntityAtId(entity.entityHash, { handle: entity.handle })
		hits.push({
			kind: 'user',
			entityHash: entity.entityHash,
			handle: entity.handle,
			alias: entity.alias,
			name: entity.name,
			activePubKeyHex: entity.activePubKeyHex,
			label: entity.alias || entity.name || handle,
			subtitle: handle,
		})
	}

	resultsHost.replaceChildren()
	resultsHost.classList.remove('hidden')
	if (!hits.length) {
		resultsHost.appendChild(await renderTemplate('hub/friends/search_hint', {
			i18nKey: 'chat.hub.friends.search.empty',
		}))
		return
	}
	await Promise.all(hits.map(enrichFriendsSearchHit))
	for (const hit of hits)
		await appendFriendsSearchHit(hit, resultsHost)
}
