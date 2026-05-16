import {
	getChannelMessages,
	getGroupList,
	getGroupState,
	getChatBookmarks,
	joinGroup,
	joinGroupById,
	sendGroupMessage,
	showCreateGroupModal,
} from '/parts/shells:chat/src/groupUI.mjs'
import { initializeWebSocket } from '../src/websocket.mjs'

import { avatarColor, avatarInitial, escapeHtml, formatTime } from './domUtils.mjs'
import {
	appendChannelMessagesHtml,
	renderMessageContent,
	renderMessages,
} from './messageRender.mjs'

// ============ 状态 ============
let groups = []
/** 侧栏文件夹（`GET …/group-folders`；与 §19 `groupFolders.json` 对齐） */
let groupFoldersState = { folders: [] }
let currentGroupId = null
let currentChannelId = null
let currentState = null
let lastMessageId = null
let pollTimer = null
let myUsername = null
// 由用户发送动作触发：下一次消息渲染强制滚动到底部，
// 与之相对，普通轮询/他人消息只在用户已在底部附近时才自动滚动，避免"抢滚动"。
let forceScrollOnNext = false
const collapsedCategories = new Set()

// AI 角色 1:1 聊天嵌入模式（底层仍为 DAG 群 /groups/:groupId）
let currentAIChatId = null
let currentAIChar = null
let aiChatWs = null
let aiChatLogLength = 0
// 流式消息追踪：messageId → { index, content, content_for_show }
const streamingEntries = new Map()

// ============ 工具 ============
/**
 * 显示或隐藏 Hub 频道栏内「置顶 / 书签」折叠区。
 * @param {boolean} on 是否显示
 * @returns {void}
 */
function setHubPinsBookmarksWrapVisible(on) {
	const wrap = document.getElementById('hub-pins-bookmarks-wrap')
	if (!wrap) return
	if (on) wrap.removeAttribute('hidden')
	else wrap.setAttribute('hidden', '')
}

/**
 * 主区顶部明文安全警示条（依赖 `currentMode` / `currentGroupId` / `currentChannelId` / `currentState`）。
 * @returns {void}
 */
function updateHubPlaintextMainBanner() {
	const el = document.getElementById('hub-plaintext-main-banner')
	if (!el) return
	if (currentMode !== 'groups' || !currentGroupId || !currentChannelId || !currentState) {
		el.setAttribute('hidden', '')
		el.textContent = ''
		return
	}
	// §11 GSH 强制加密，无明文警示逻辑
	el.setAttribute('hidden', '')
	el.textContent = ''
}

/**
 * 从 `currentState.pinsByChannel` 与书签 API 填充 Hub 侧栏（§7.3）。
 * @returns {Promise<void>}
 */
async function refreshHubPinsBookmarks() {
	const pinsHost = document.getElementById('hub-pins-wrap')
	const bmHost = document.getElementById('hub-bookmarks-wrap')
	if (!pinsHost || !bmHost) return
	if (currentMode !== 'groups' || !currentGroupId || !currentState?.isMember) {
		setHubPinsBookmarksWrapVisible(false)
		return
	}
	setHubPinsBookmarksWrapVisible(true)
	const pinsBy = currentState.pinsByChannel || {}
	const pinRows = []
	for (const [cid, ids] of Object.entries(pinsBy)) {
		if (!Array.isArray(ids) || !ids.length) continue
		const chName = currentState.channels?.[cid]?.name || cid
		for (const eid of ids) {
			if (typeof eid !== 'string' || !eid) continue
			const short = eid.length > 10 ? `${eid.slice(0, 8)}…` : eid
			pinRows.push(
				`<button type="button" class="hub-side-link hub-pin-row" data-pin-channel="${escapeHtml(cid)}" data-pin-event="${escapeHtml(eid)}">📌 ${escapeHtml(chName)} · ${escapeHtml(short)}</button>`,
			)
		}
	}
	pinsHost.innerHTML = pinRows.length
		? pinRows.join('')
		: '<div class="hub-side-muted">暂无置顶</div>'
	pinsHost.querySelectorAll('.hub-pin-row').forEach((btn) => {
		btn.addEventListener('click', async () => {
			const cid = btn.getAttribute('data-pin-channel')
			const eid = btn.getAttribute('data-pin-event')
			if (!cid || !eid) return
			if (cid !== currentChannelId)
				await selectChannel(cid)
			else
				await loadMessages()

			const row = document.querySelector(`#messages [data-message-id="${eid}"]`)
			row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
		})
	})

	let bookmarks = []
	try {
		bookmarks = await getChatBookmarks()
	}
	catch {
		bookmarks = []
	}
	const here = bookmarks.filter(b => b && b.groupId === currentGroupId)
	const bmRows = here.map((b) => {
		const title = escapeHtml(b.title || b.eventId || '书签')
		const href = typeof b.href === 'string' && b.href.trim()
			? b.href.trim()
			: `#group:${encodeURIComponent(currentGroupId)}:${encodeURIComponent(b.channelId || currentChannelId || 'default')}`
		return `<a class="hub-side-link" href="${escapeHtml(href)}">${title}</a>`
	})
	bmHost.innerHTML = bmRows.length ? bmRows.join('') : '<div class="hub-side-muted">当前群无书签</div>'
}

// === 入群欢迎语选择器 ===
const JOIN_GREETINGS = [
	'跳进了服务器',
	'神秘登场',
	'闪亮登场了',
	'空降到此',
	'来串门了',
	'加入了狂欢',
	'刚刚降落',
	'潜入了对话',
	'🎉 闯入了！',
	'正式加入',
]
/**
 * 弹出模态框让用户选择入群问候语。
 * @returns {Promise<string|null>} 选中的问候语；跳过或关闭为 null
 */
function showGreetingPicker() {
	return new Promise((resolve) => {
		const modal = document.createElement('dialog')
		modal.className = 'modal'
		modal.innerHTML = `

<div class="modal-box gp-box">
<div class="gp-header">
<h3>👋 选择你的入场宣言</h3>
<p>让大家看看你的入场风格</p>
</div>
<div class="gp-body">
<div class="gp-grid">
${
	JOIN_GREETINGS.map((g) =>
		`<button class="gp-item" data-g="${escapeHtml(g)}">${
			escapeHtml(g)
		}</button>`
	).join('')
}
</div>
</div>
<div class="gp-footer">
<button class="gp-skip" data-skip>低调登场（跳过）</button>
</div>
</div>
<form method="dialog" class="modal-backdrop"><button>关闭</button></form>
`
		/**
		 * 关闭问候语选择器并结束 Promise。
		 * @param {string|null} val - 选中的问候语；跳过为 null
		 * @returns {void} 无
		 */
		const close = (val) => {
			resolve(val)
			try {
				modal.close()
			} catch {}
			modal.remove()
		}
		modal.querySelectorAll('.gp-item').forEach((b) =>
			b.addEventListener('click', () => close(b.dataset.g))
		)
		modal.querySelector('[data-skip]').addEventListener(
			'click',
			() => close(null),
		)
		modal.addEventListener('close', () => close(null))
		document.body.appendChild(modal)
		modal.showModal()
	})
}

// ============ URL hash ============
/**
 * 从当前 `location.hash` 解析群组与频道 ID。
 * @returns {{groupId: string|null, channelId: string|null}} 路由解析结果
 */
function parseHash() {
	const hash = window.location.hash.substring(1)
	if (!hash.startsWith('group:')) return { groupId: null, channelId: null }
	const rest = hash.slice('group:'.length).split(':')
	if (rest.length < 2 || !rest[0] || !rest[1]) 
		return { groupId: null, channelId: null }
  
	return { groupId: rest[0], channelId: rest[1] }
}

/**
 * 使用 `history.replaceState` 同步地址栏 hash（仅 `group:groupId:channelId`，§5）。
 * @param {string|null} groupId - 群组 ID
 * @param {string|null} [channelId] - 频道 ID
 * @returns {void} 无
 */
function updateHash(groupId, channelId) {
	if (!groupId) return
	const newHash = `group:${groupId}:${channelId || 'default'}`
	if (window.location.hash.substring(1) !== newHash)
		history.replaceState(null, '', '#' + newHash)
}

// 在线状态批量查询 + 心跳
/**
 * 批量查询用户在线状态。
 * @param {string[]} [usernames] - 用户名列表
 * @returns {Promise<Object<string, {status?: string}>>} 用户名到状态对象的映射
 */
async function fetchBulkPresence(usernames) {
	if (!usernames?.length) return {}
	try {
		const url = '/api/presence?users=' +
      encodeURIComponent(usernames.join(','))
		const resp = await fetch(url, { credentials: 'include' })
		if (!resp.ok) return {}
		const data = await resp.json()
		return data?.statuses || {}
	} catch {
		return {}
	}
}
setInterval(() => {
	fetch('/api/presence/ping', { method: 'POST', credentials: 'include' }).catch(
		() => {},
	)
}, 30 * 1000)

const PRESENCE_LABEL = { online: '在线', idle: '挂起', offline: '离线' }
/**
 * 将在线状态圆点与标题更新到指定根节点下的成员 UI。
 * @param {HTMLElement} rootEl - 包含 `.hub-presence-dot` 的容器
 * @param {string[]} [usernames] - 需要刷新的用户名
 * @returns {Promise<void>} 异步请求完成后无返回值
 */
async function applyPresence(rootEl, usernames) {
	if (!usernames?.length) return
	const statuses = await fetchBulkPresence(usernames)
	for (const uname of usernames) {
		const info = statuses[uname] || { status: 'offline' }
		const dot = rootEl.querySelector(
			`.hub-presence-dot[data-presence-for="${CSS.escape(uname)}"]`,
		)
		if (dot) {
			dot.classList.remove(
				'hub-presence-online',
				'hub-presence-idle',
				'hub-presence-offline',
			)
			dot.classList.add(`hub-presence-${info.status}`)
			dot.title = PRESENCE_LABEL[info.status] || '离线'
		}
	}
}
let hubMemberPresenceTimer = null
/**
 * 定时刷新成员在线状态；根节点从文档移除时自动停止。
 * @param {HTMLElement} rootEl - 成员列表容器
 * @param {string[]} usernames - 轮询的用户名列表
 * @returns {void} 无
 */
function startMemberPresencePolling(rootEl, usernames) {
	if (hubMemberPresenceTimer) clearInterval(hubMemberPresenceTimer)
	hubMemberPresenceTimer = setInterval(() => {
		if (!document.body.contains(rootEl)) {
			clearInterval(hubMemberPresenceTimer)
			hubMemberPresenceTimer = null
			return
		}
		applyPresence(rootEl, usernames)
	}, 20 * 1000)
}

// 头像缓存：username -> avatar URL（null 表示无头像）
const avatarCache = new Map()
/**
 * 拉取并缓存用户头像 URL。
 * @param {string} [username] - 用户名
 * @returns {Promise<string|null>} 头像地址；无则 null
 */
async function fetchUserAvatar(username) {
	if (!username) return null
	if (avatarCache.has(username)) return avatarCache.get(username)
	try {
		const resp = await fetch(
			`/api/parts/shells:chat/profile/${encodeURIComponent(username)}`,
			{ credentials: 'include' },
		)
		if (!resp.ok) {
			avatarCache.set(username, null)
			return null
		}
		const data = await resp.json()
		const avatar = data?.profile?.avatar || data?.data?.avatar ||
      data?.avatar || null
		avatarCache.set(username, avatar || null)
		return avatar || null
	} catch {
		avatarCache.set(username, null)
		return null
	}
}

/**
 * 为元素绑定悬停显示资料卡的行为。
 * @param {HTMLElement} el - 锚点元素
 * @param {() => string|undefined|null} getUname - 返回当前关联用户名
 * @returns {void} 无
 */
function bindHoverCardAnchor(el, getUname) {
	if (!el || el.dataset.hoverBound) return
	el.dataset.hoverBound = '1'
	el.addEventListener('mouseenter', () => {
		const uname = getUname()
		if (uname) showHoverCardFor(uname, el)
	})
	el.addEventListener('mouseleave', (e) => {
		// 鼠标进入悬浮卡内时不隐藏（由 hoverCard 自己处理）
		const hc = document.getElementById('profile-hover-card')
		if (hc && hc.contains(e.relatedTarget)) return
		hideHoverCard()
	})
}

/**
 * 为容器内头像占位符加载图片并绑定资料卡锚点。
 * @param {HTMLElement} rootEl - 消息或成员列表根节点
 * @returns {void} 无
 */
function applyAvatarsTo(rootEl) {
	const avEls = rootEl.querySelectorAll(
		'.hub-avatar[data-avatar-for], .hub-member-avatar[data-avatar-for]',
	)
	avEls.forEach((av) => {
		const uname = av.dataset.avatarFor
		if (!uname) return
		bindHoverCardAnchor(av, () => av.dataset.avatarFor)
		if (av.dataset.avatarLoaded) return
		av.dataset.avatarLoaded = '1'
		fetchUserAvatar(uname).then((avatar) => {
			if (avatar) 
				av.innerHTML = `<img src="${avatar}" alt="${
					escapeHtml(uname)
				}" style="width:100%;height:100%;object-fit:cover;" />`
      
		})
	})
	// 同步绑定消息作者名 / 成员条目
	rootEl.querySelectorAll('.hub-message-author, .hub-system-author').forEach(
		(au) => {
			bindHoverCardAnchor(au, () => au.textContent.trim())
		},
	)
	rootEl.querySelectorAll('.hub-member-item').forEach((mi) => {
		bindHoverCardAnchor(
			mi,
			() => mi.querySelector('[data-avatar-for]')?.dataset.avatarFor,
		)
	})
}

// ============ 加载用户 ============
/**
 *
 */
async function loadMe() {
	try {
		const resp = await fetch('/api/user/me', { credentials: 'include' })
		if (!resp.ok) return
		const me = await resp.json()
		myUsername = me.username || me.data?.username || '?'
		const myAvatar = document.getElementById('my-avatar')
		const myName = document.getElementById('my-name')
		myAvatar.textContent = avatarInitial(myUsername)
		myAvatar.style.background = avatarColor(myUsername)
		myName.textContent = myUsername
		// 加载真实头像
		const avatar = await fetchUserAvatar(myUsername)
		if (avatar) 
			myAvatar.innerHTML = `<img src="${avatar}" alt="${
				escapeHtml(myUsername)
			}" style="width:100%;height:100%;object-fit:cover;" />`
    
	} catch {}
}

// ============ 服务器栏 ============
/**
 *
 */
async function loadGroups() {
	try {
		const [gfRes, gl] = await Promise.all([
			fetch('/api/parts/shells:chat/group-folders', { credentials: 'include' }),
			getGroupList(),
		])
		groups = gl
		if (gfRes.ok) {
			const j = await gfRes.json().catch(() => ({}))
			const rawFolders = Array.isArray(j.folders) ? j.folders : []
			groupFoldersState = {
				folders: rawFolders.map((f, i) => ({
					id: typeof f.id === 'string' && f.id.trim() ? f.id.trim() : `folder-${i}`,
					name: typeof f.name === 'string' && f.name.trim() ? f.name.trim() : '文件夹',
					groupIds: Array.isArray(f.groupIds) ? f.groupIds.filter(x => typeof x === 'string' && x) : [],
					collapsed: !!f.collapsed,
				})),
			}
		}
		else groupFoldersState = { folders: [] }

		renderServerBar()
	}
	catch (err) {
		console.error('Failed to load groups:', err)
	}
}

/**
 * 单个群图标（左侧栏）。
 * @param {{ groupId: string, name?: string }} g - 群摘要
 * @returns {string} HTML 片段
 */
function hubServerItemHtml(g) {
	const initial = avatarInitial(g.name)
	const color = avatarColor(g.name)
	const active = g.groupId === currentGroupId ? 'active' : ''
	return `
<div class="hub-server-item ${active}" data-group-id="${escapeHtml(g.groupId)}" style="background: ${
	active ? '' : color
};">
${escapeHtml(initial)}
<span class="hub-server-tooltip">${escapeHtml(g.name)}</span>
</div>
`
}

/**
 *
 */
function renderServerBar() {
	const list = document.getElementById('server-list')
	if (!groups.length) {
		list.innerHTML = `
<div class="hub-server-divider" style="width:32px;height:2px;background:var(--hub-bg-floating);margin:4px auto 8px;border-radius:1px;"></div>
<div style="color:var(--hub-text-muted);font-size:9px;font-weight:700;letter-spacing:0.5px;text-align:center;text-transform:uppercase;margin-bottom:6px;">群组</div>
`
		return
	}

	const byId = new Map(groups.map(g => [g.groupId, g]))
	const used = new Set()
	let bodyHtml = ''

	const folders = groupFoldersState.folders || []
	if (folders.length) {
		folders.forEach((f, fi) => {
			const collapsed = !!f.collapsed
			bodyHtml += `
<div class="hub-folder-wrap" data-folder-idx="${fi}">
<div class="hub-folder-head" data-folder-idx="${fi}" style="color:var(--hub-text-muted);font-size:10px;font-weight:700;padding:6px 4px 4px;cursor:pointer;user-select:none;text-align:center;">
${collapsed ? '▸' : '▾'} ${escapeHtml(f.name)}
</div>
${collapsed ? '' : `<div class="hub-folder-items" style="display:flex;flex-direction:column;align-items:center;gap:4px;">${
	f.groupIds.map((gid) => {
		const g = byId.get(gid)
		if (!g) return ''
		used.add(gid)
		return hubServerItemHtml(g)
	}).join('')
}</div>`}
</div>`
		})
		const ungrouped = groups.filter(g => !used.has(g.groupId))
		if (ungrouped.length) 
			bodyHtml += `
<div class="hub-folder-wrap" data-folder-id="__ungrouped__">
<div class="hub-folder-head" style="color:var(--hub-text-muted);font-size:10px;font-weight:700;padding:8px 4px 4px;text-align:center;">未分组</div>
<div class="hub-folder-items" style="display:flex;flex-direction:column;align-items:center;gap:4px;">
${ungrouped.map(hubServerItemHtml).join('')}
</div>
</div>`
		
	}
	else bodyHtml = groups.map(hubServerItemHtml).join('')

	list.innerHTML = `
<div class="hub-server-divider" style="width:32px;height:2px;background:var(--hub-bg-floating);margin:4px auto 6px;border-radius:1px;"></div>
<div style="color:var(--hub-text-muted);font-size:9px;font-weight:700;letter-spacing:0.5px;text-align:center;text-transform:uppercase;margin-bottom:6px;">群组</div>
${bodyHtml}
`

	list.querySelectorAll('.hub-server-item').forEach((el) => {
		el.addEventListener('click', () => selectGroup(el.dataset.groupId))
	})
	list.querySelectorAll('.hub-folder-head[data-folder-idx]').forEach((head) => {
		head.addEventListener('click', (ev) => {
			ev.stopPropagation()
			const idx = Number(head.getAttribute('data-folder-idx'))
			if (!Number.isFinite(idx) || idx < 0 || idx >= groupFoldersState.folders.length) return
			groupFoldersState.folders[idx].collapsed = !groupFoldersState.folders[idx].collapsed
			void fetch('/api/parts/shells:chat/group-folders', {
				method: 'PUT',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ folders: groupFoldersState.folders }),
			}).catch(() => {})
			renderServerBar()
		})
	})
}

// ============ 选择服务器 ============
/**
 * 切换到指定群组并加载频道与成员；非成员时自动入群。
 * @param {string} groupId - 群组 ID
 * @param {string|null} [presetChannelId] - 优先选中的频道 ID
 * @returns {Promise<void>} 异步完成；失败时 alert
 */
async function selectGroup(groupId, presetChannelId = null) {
	if (!groupId) return
	clearAIChatState()
	if (pollTimer) {
		clearInterval(pollTimer)
		pollTimer = null
	}
	currentGroupId = groupId
	renderServerBar() // 更新高亮

	try {
		let state = await getGroupState(groupId)
		let justJoined = false
		if (!state.isMember) {
			await joinGroup(groupId)
			state = await getGroupState(groupId)
			justJoined = true
			// 刷新群组列表，使新加入的群组立刻出现在左侧栏
			await loadGroups()
		}
		currentState = state

		// 首次加入群组 → 弹出打招呼选择器，发送系统欢迎消息
		if (justJoined) {
			const greeting = await showGreetingPicker()
			if (greeting) {
				const defaultCh = state.groupSettings?.defaultChannelId ||
          Object.keys(state.channels || {})[0]
				if (defaultCh) 
					try {
						await sendGroupMessage(groupId, defaultCh, `[join:${greeting}]`)
					} catch {}
        
			}
		}

		document.getElementById('group-name-display').textContent =
      state.groupMeta.name || '群组'
		renderChannelList(state)
		renderMemberList(state)
		if (typeof window.__hubAfterSelectGroup === 'function') 
			window.__hubAfterSelectGroup(state)
    

		const channelIds = Object.keys(state.channels || {})
		const targetChannelId = presetChannelId && state.channels?.[presetChannelId]
      ? presetChannelId
      : state.groupSettings?.defaultChannelId || channelIds[0] || null

		if (targetChannelId) await selectChannel(targetChannelId)
		else {
			currentChannelId = null
			updateHash(currentGroupId, null)
			disableComposer('暂无可用对话')
			updateHubPlaintextMainBanner()
			void refreshHubPinsBookmarks()
		}
	} catch (err) {
		setHubPinsBookmarksWrapVisible(false)
		updateHubPlaintextMainBanner()
		alert('加载群组失败: ' + err.message)
	}
}

// ============ 渲染频道列表 ============
/**
 * 根据群组状态渲染左侧频道树（含分类折叠）。
 * @param {{channels?: Object, groupSettings?: {defaultChannelId?: string}}} state - 群组状态
 * @returns {void} 无
 */
function renderChannelList(state) {
	const container = document.getElementById('channel-list')
	const channels = state.channels || {}
	const channelIds = Object.keys(channels)

	if (!channelIds.length) {
		container.innerHTML =
      '<div style="padding: 16px; color: var(--hub-text-muted); font-size: 14px;">暂无对话</div>'
		return
	}

	// 按 category 分组（如果存在）
	const groupsByCat = {}
	for (const id of channelIds) {
		const ch = channels[id]
		const cat = ch.category || '对话'
		if (!groupsByCat[cat]) groupsByCat[cat] = []
		groupsByCat[cat].push({ id, ...ch })
	}

	container.innerHTML = Object.keys(groupsByCat).map((cat) => {
		const isCollapsed = collapsedCategories.has(cat)
		const channelsHtml = isCollapsed ? '' : groupsByCat[cat].map((ch) => {
			const active = ch.id === currentChannelId ? 'active' : ''
			return `
<div class="hub-channel-item ${active}" data-channel-id="${ch.id}">
<svg class="hub-channel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
<line x1="4" y1="9" x2="20" y2="9"/>
<line x1="4" y1="15" x2="20" y2="15"/>
<line x1="10" y1="3" x2="8" y2="21"/>
<line x1="16" y1="3" x2="14" y2="21"/>
</svg>
<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${
        escapeHtml(ch.name || ch.id)
      }</span>
</div>
`
		}).join('')

		return `
<div class="hub-category ${isCollapsed ? 'collapsed' : ''}" data-cat="${
	escapeHtml(cat)
}">
<svg class="hub-category-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
<span>${escapeHtml(cat)}</span>
</div>
${channelsHtml}
`
	}).join('')

	container.querySelectorAll('.hub-category').forEach((el) => {
		el.addEventListener('click', () => {
			const cat = el.dataset.cat
			if (collapsedCategories.has(cat)) collapsedCategories.delete(cat)
			else collapsedCategories.add(cat)
			renderChannelList(currentState)
		})
	})

	container.querySelectorAll('.hub-channel-item').forEach((el) => {
		el.addEventListener('click', () => selectChannel(el.dataset.channelId))
	})
}

// ============ 选择频道 ============
/**
 * 选中群组内频道并加载消息、启动轮询。
 * @param {string} channelId - 频道 ID
 * @returns {Promise<void>} 异步完成
 */
async function selectChannel(channelId) {
	currentChannelId = channelId
	updateHash(currentGroupId, channelId)
	renderChannelList(currentState)

	const channel = currentState?.channels?.[channelId]
	document.getElementById('channel-name-display').textContent = channel?.name ||
    channelId
	enableComposer()

	await loadMessages()
	startPolling()
	updateHubPlaintextMainBanner()
	void refreshHubPinsBookmarks()
}

// ============ 渲染成员列表 ============
/**
 * 渲染右侧成员列表并刷新在线状态轮询。
 * @param {{members?: Array<{username?: string, pubKeyHash?: string, roles?: string[]}>}} state - 群组状态
 * @returns {void} 无
 */
function renderMemberList(state) {
	const container = document.getElementById('member-list')
	const members = state.members || []
	if (!members.length) {
		container.innerHTML =
      '<div style="padding: 16px; color: var(--hub-text-muted); font-size: 14px;">暂无成员</div>'
		return
	}

	const admins = members.filter((m) => (m.roles || []).includes('admin'))
	const others = members.filter((m) => !(m.roles || []).includes('admin'))

	/**
	 * 生成某一角色分组的成员 HTML 片段。
	 * @param {string} title - 分组标题（如「管理员」）
	 * @param {Array<{username?: string, pubKeyHash?: string, roles?: string[]}>} list - 成员数组
	 * @returns {string} HTML 片段；列表为空则为空字符串
	 */
	const renderGroup = (title, list) => {
		if (!list.length) return ''
		return `
<div class="hub-member-group-title">${escapeHtml(title)} — ${list.length}</div>
${
	list.map((m) => {
		const uname = m.username || m.pubKeyHash || '?'
		const isAdmin = (m.roles || []).includes('admin')
		return `
<div class="hub-member-item ${isAdmin ? 'is-admin' : ''}" title="${
	escapeHtml(uname)
}">
<div class="hub-member-avatar-wrap">
<div class="hub-member-avatar" data-avatar-for="${
	escapeHtml(uname)
}" style="background: ${avatarColor(uname)};">${
	escapeHtml(avatarInitial(uname))
}</div>
<span class="hub-presence-dot hub-presence-offline" data-presence-for="${
	escapeHtml(uname)
}" title="离线"></span>
</div>
<div class="hub-member-name">${escapeHtml(uname)}</div>
</div>
`
	}).join('')
}
`
	}

	container.innerHTML = renderGroup('管理员', admins) +
    renderGroup('成员', others)
	applyAvatarsTo(container)

	// 加载在线状态并启动定时刷新
	const allUsers = [...admins, ...others].map((m) => m.username || m.pubKeyHash)
		.filter(Boolean)
	applyPresence(container, allUsers)
	startMemberPresencePolling(container, allUsers)
}

// ============ 消息 ============
/**
 * 拉取当前频道消息并渲染消息区。
 * @returns {Promise<void>} 异步完成
 */
async function loadMessages() {
	const container = document.getElementById('messages')
	container.innerHTML =
    '<div class="hub-empty"><div class="loading loading-spinner"></div></div>'
	try {
		const messages = await getChannelMessages(
			currentGroupId,
			currentChannelId,
			{ limit: 50 },
		)
		if (!messages.length) {
			container.innerHTML = `
<div class="hub-empty">
<div class="hub-empty-icon">👋</div>
<div style="color: var(--hub-text-bright); font-size: 18px; font-weight: 600; margin-bottom: 8px;">欢迎来到 #${
	escapeHtml(
		currentState?.channels?.[currentChannelId]?.name || currentChannelId,
	)
}</div>
<div>这是该对话的开始。发送第一条消息吧！</div>
</div>
`
			lastMessageId = null
			return
		}
		container.innerHTML = renderMessages(messages)
		lastMessageId = messages[messages.length - 1].id
		applyAvatarsTo(container)
		scrollToBottom()
	} catch (err) {
		container.innerHTML =
      `<div class="hub-empty"><div style="color:#ed4245">加载消息失败: ${
      	escapeHtml(err.message)
      }</div></div>`
	}
}

/**
 *
 */
function scrollToBottom() {
	const container = document.getElementById('messages')
	container.scrollTop = container.scrollHeight
}

/**
 *
 */
function startPolling() {
	if (pollTimer) clearInterval(pollTimer)
	pollTimer = setInterval(pollNewMessages, 2500)
}

/**
 *
 */
async function pollNewMessages() {
	if (!currentGroupId || !currentChannelId) return
	const options = { limit: 50 }
	if (lastMessageId) options.since = lastMessageId
	const messages = await getChannelMessages(currentGroupId, currentChannelId, options)
	if (!messages.length) return

	const container = document.getElementById('messages')
	const empty = container.querySelector('.hub-empty')
	if (empty) container.innerHTML = ''

	const nearBottom =
		container.scrollHeight - container.scrollTop - container.clientHeight < 100
	const lastSender = container.querySelector('.hub-message:last-child .hub-message-author')?.textContent
	const fresh = messages.filter(message => !container.querySelector(`[data-message-id="${message.id}"]`))
	const { html: appended } = appendChannelMessagesHtml(fresh, lastSender)
	if (!appended) return

	container.insertAdjacentHTML('beforeend', appended)
	lastMessageId = messages[messages.length - 1].id
	applyAvatarsTo(container)
	if (forceScrollOnNext || nearBottom) scrollToBottom()
	forceScrollOnNext = false
}

// ============ 输入框 ============
/**
 *
 */
function enableComposer() {
	const input = document.getElementById('message-input')
	input.disabled = false
	input.placeholder = `发送消息到 #${
		currentState?.channels?.[currentChannelId]?.name || currentChannelId
	}`
	document.getElementById('emoji-btn').disabled = false
	document.getElementById('upload-btn').disabled = false
	document.getElementById('sticker-btn').disabled = false
	document.getElementById('send-btn').disabled = false
}
/**
 * 禁用输入区并显示占位提示。
 * @param {string} [reason] - 禁用原因文案
 * @returns {void} 无
 */
function disableComposer(reason) {
	const input = document.getElementById('message-input')
	input.disabled = true
	input.placeholder = reason || '无法发送消息'
	document.getElementById('emoji-btn').disabled = true
	document.getElementById('upload-btn').disabled = true
	document.getElementById('sticker-btn').disabled = true
	document.getElementById('send-btn').disabled = true
}

// === 统一消息发送（支持群组 / 独立频道 / AI 角色） ===
/**
 * 按当前上下文发送一条文本消息（含 AI / 独立频道 / 群组）。
 * @param {string} content - 消息正文
 * @returns {Promise<void>} 发送与后续刷新完成后无返回值
 */
async function sendCurrentMessage(content) {
	// 用户主动发送：要求下一次消息渲染（无论是 poll 拉回的本人消息、
	// AI 通过 WS 推送的回复、还是图片/贴纸触发的渲染）强制滚动到底部
	forceScrollOnNext = true
	if (currentAIChatId && currentAIChar) {
		await sendAIChatMessage(content)
		return
	}
	if (!currentGroupId || !currentChannelId) throw new Error('请先选择对话')
	await sendGroupMessage(currentGroupId, currentChannelId, content)
	await pollNewMessages()
}

/**
 *
 */
async function submitComposer() {
	const input = document.getElementById('message-input')
	if (input.disabled) return
	const content = input.value.trim()
	if (!content) return
	if (!currentAIChatId && (!currentGroupId || !currentChannelId)) return
	input.value = ''
	try {
		await sendCurrentMessage(content)
	} catch (err) {
		forceScrollOnNext = false // 发送失败：避免下次无关 poll 抢滚动
		alert('发送失败: ' + err.message)
		input.value = content
	}
}

document.getElementById('message-input').addEventListener('keydown', (e) => {
	if (e.key !== 'Enter') return
	// Ctrl+Enter / Shift+Enter → 换行
	if (e.ctrlKey || e.shiftKey || e.metaKey) {
		e.preventDefault()
		const input = e.target
		const start = input.selectionStart
		const end = input.selectionEnd
		input.value = input.value.slice(0, start) + '\n' + input.value.slice(end)
		input.selectionStart = input.selectionEnd = start + 1
		return
	}
	e.preventDefault()
	submitComposer()
})

document.getElementById('send-btn').addEventListener('click', () => {
	submitComposer()
	document.getElementById('message-input').focus()
})

// ============ 图片上传 ============
document.getElementById('upload-btn').addEventListener('click', () => {
	document.getElementById('image-upload').click()
})

document.getElementById('image-upload').addEventListener(
	'change',
	async (e) => {
		const file = e.target.files[0]
		if (!file) return
		if (!currentAIChatId && (!currentGroupId || !currentChannelId)) return
		e.target.value = ''
		try {
			const reader = new FileReader()
			const dataUrl = await new Promise((resolve, reject) => {
				/**
				 * 读取完成后将 data URL 交给 Promise。
				 * @returns {void} 无
				 */
				reader.onload = () => resolve(reader.result)
				reader.onerror = reject
				reader.readAsDataURL(file)
			})
			await sendCurrentMessage(`[image:${file.name}|${dataUrl}]`)
		} catch (err) {
			alert('发送图片失败: ' + err.message)
		}
	},
)

// ============ Emoji 选择器 ============
const EMOJI_DATA = {
	face: [
		'😀',
		'😃',
		'😄',
		'😁',
		'😆',
		'😅',
		'🤣',
		'😂',
		'🙂',
		'🙃',
		'😉',
		'😊',
		'😇',
		'🥰',
		'😍',
		'🤩',
		'😘',
		'😗',
		'😚',
		'😙',
		'😋',
		'😛',
		'😜',
		'🤪',
		'😝',
		'🤑',
		'🤗',
		'🤭',
		'🤫',
		'🤔',
		'🤐',
		'🤨',
		'😐',
		'😑',
		'😶',
		'😏',
		'😒',
		'🙄',
		'😬',
		'🤥',
		'😌',
		'😔',
		'😪',
		'🤤',
		'😴',
		'😷',
		'🤒',
		'🤕',
		'🤢',
		'🤮',
		'🤧',
		'🥵',
		'🥶',
		'🥴',
		'😵',
		'🤯',
		'🤠',
		'🥳',
		'😎',
		'🤓',
		'🧐',
	],
	gesture: [
		'👋',
		'🤚',
		'🖐️',
		'✋',
		'🖖',
		'👌',
		'🤏',
		'✌️',
		'🤞',
		'🤟',
		'🤘',
		'🤙',
		'👈',
		'👉',
		'👆',
		'👇',
		'☝️',
		'👍',
		'👎',
		'✊',
		'👊',
		'🤛',
		'🤜',
		'👏',
		'🙌',
		'👐',
		'🤲',
		'🤝',
		'🙏',
	],
	heart: [
		'❤️',
		'🧡',
		'💛',
		'💚',
		'💙',
		'💜',
		'🖤',
		'🤍',
		'🤎',
		'💔',
		'❣️',
		'💕',
		'💞',
		'💓',
		'💗',
		'💖',
		'💘',
		'💝',
		'💟',
		'♥️',
	],
	animal: [
		'🐱',
		'🐶',
		'🐭',
		'🐹',
		'🐰',
		'🦊',
		'🐻',
		'🐼',
		'🐨',
		'🐯',
		'🦁',
		'🐮',
		'🐷',
		'🐸',
		'🐵',
		'🙈',
		'🙉',
		'🙊',
		'🐒',
		'🐔',
		'🐧',
		'🐦',
		'🐤',
		'🐣',
		'🦆',
		'🦅',
		'🦉',
		'🦇',
		'🐺',
		'🐗',
		'🐴',
		'🦄',
		'🐝',
		'🐛',
		'🦋',
		'🐌',
		'🐞',
		'🐜',
		'🐢',
		'🐍',
		'🦎',
		'🦂',
		'🦀',
		'🦑',
		'🐙',
		'🐠',
		'🐟',
		'🐡',
		'🐬',
		'🦈',
		'🐳',
		'🐋',
	],
	food: [
		'🍔',
		'🍟',
		'🍕',
		'🌭',
		'🥪',
		'🌮',
		'🌯',
		'🥙',
		'🍣',
		'🍤',
		'🍥',
		'🍱',
		'🍙',
		'🍚',
		'🍛',
		'🍜',
		'🍝',
		'🍞',
		'🥐',
		'🥖',
		'🥨',
		'🧀',
		'🥚',
		'🍳',
		'🥘',
		'🍲',
		'🥗',
		'🍿',
		'🍦',
		'🍧',
		'🍨',
		'🍩',
		'🍪',
		'🎂',
		'🍰',
		'🧁',
		'🥧',
		'🍫',
		'🍬',
		'🍭',
		'🍮',
		'🍯',
		'🥛',
		'☕',
		'🍵',
		'🍶',
		'🍺',
		'🍻',
		'🥂',
		'🍷',
	],
	object: [
		'⚽',
		'🏀',
		'🏈',
		'⚾',
		'🥎',
		'🎾',
		'🏐',
		'🏉',
		'🥏',
		'🎱',
		'🏓',
		'🏸',
		'🥊',
		'🎯',
		'🎲',
		'🧩',
		'🎤',
		'🎧',
		'🎼',
		'🎹',
		'🥁',
		'🎷',
		'🎺',
		'🎸',
		'🎻',
		'🏆',
		'🥇',
		'🥈',
		'🥉',
		'🎁',
		'🎀',
	],
}

/**
 * 按分类键渲染 Emoji 选择器网格按钮。
 * @param {string} tab - `EMOJI_DATA` 的键名
 * @returns {void} 无
 */
function renderEmojiGrid(tab) {
	const grid = document.getElementById('emoji-grid')
	grid.innerHTML = (EMOJI_DATA[tab] || []).map((e) =>
		`<button class="hub-emoji-btn" data-emoji="${e}">${e}</button>`
	).join('')
}

document.getElementById('emoji-btn').addEventListener('click', (e) => {
	e.stopPropagation()
	const picker = document.getElementById('emoji-picker')
	picker.classList.toggle('show')
	if (picker.classList.contains('show')) renderEmojiGrid('face')
})

document.getElementById('emoji-tabs').addEventListener('click', (e) => {
	const btn = e.target.closest('[data-tab]')
	if (!btn) return
	document.querySelectorAll('.hub-emoji-tab').forEach((t) =>
		t.classList.remove('active')
	)
	btn.classList.add('active')
	renderEmojiGrid(btn.dataset.tab)
})

document.getElementById('emoji-grid').addEventListener('click', (e) => {
	const btn = e.target.closest('[data-emoji]')
	if (!btn) return
	const input = document.getElementById('message-input')
	const start = input.selectionStart || input.value.length
	input.value = input.value.substring(0, start) + btn.dataset.emoji +
    input.value.substring(start)
	input.focus()
	document.getElementById('emoji-picker').classList.remove('show')
})

document.addEventListener('click', (e) => {
	const picker = document.getElementById('emoji-picker')
	if (
		picker.classList.contains('show') && !picker.contains(e.target) &&
    !e.target.closest('#emoji-btn')
	) 
		picker.classList.remove('show')
  
	const sPicker = document.getElementById('sticker-picker')
	if (
		sPicker.classList.contains('show') && !sPicker.contains(e.target) &&
    !e.target.closest('#sticker-btn')
	) 
		sPicker.classList.remove('show')
  
})

// ============ 贴纸选择器 ============
let stickersLoaded = false
/**
 *
 */
async function loadStickers() {
	if (stickersLoaded) return
	stickersLoaded = true
	const grid = document.getElementById('sticker-grid')
	try {
		if (!myUsername) throw new Error('未获取用户名')
		const collResp = await fetch(
			`/api/parts/shells:chat/stickers/user/${encodeURIComponent(myUsername)}`,
			{ credentials: 'include' },
		)
		if (!collResp.ok) throw new Error('Failed')
		const collData = await collResp.json()
		if (!collData.success) throw new Error(collData.error || 'Failed')

		const packs = collData.collection?.installedPacks || []
		if (!packs.length) {
			grid.innerHTML =
        '<div style="grid-column:1/-1;text-align:center;color:var(--hub-text-muted);padding:20px;font-size:13px;">暂无贴纸<br/><a href="/parts/shells:chat/stickers" target="_blank" style="color:var(--hub-accent);">前往贴纸广场安装</a></div>'
			return
		}

		const allStickers = []
		for (const packId of packs) 
			try {
				const packResp = await fetch(
					`/api/parts/shells:chat/stickers/packs/${encodeURIComponent(packId)}`,
					{ credentials: 'include' },
				)
				if (!packResp.ok) continue
				const packData = await packResp.json()
				if (packData.success && packData.pack?.stickers) 
					allStickers.push(...packData.pack.stickers)
        
			} catch {}
    

		if (!allStickers.length) {
			grid.innerHTML =
        '<div style="grid-column:1/-1;text-align:center;color:var(--hub-text-muted);padding:20px;font-size:13px;">暂无贴纸</div>'
			return
		}

		grid.innerHTML = allStickers.map((s) => `
<button class="hub-sticker-item" data-sticker-id="${
	escapeHtml(s.id)
}" data-sticker-url="${escapeHtml(s.url || '')}" title="${
	escapeHtml(s.name || s.id)
}">
${
      s.url
        ? `<img src="${escapeHtml(s.url)}" alt="${escapeHtml(s.name || '')}" />`
        : '<span style="font-size:24px;">📦</span>'
}
</button>
`).join('')
	} catch (err) {
		stickersLoaded = false
		grid.innerHTML =
      `<div style="grid-column:1/-1;text-align:center;color:var(--hub-text-muted);padding:20px;font-size:13px;">加载失败：${
      	escapeHtml(err.message)
      }</div>`
	}
}

document.getElementById('sticker-btn').addEventListener('click', (e) => {
	e.stopPropagation()
	const picker = document.getElementById('sticker-picker')
	document.getElementById('emoji-picker').classList.remove('show')
	picker.classList.toggle('show')
	if (picker.classList.contains('show')) loadStickers()
})

document.getElementById('sticker-grid').addEventListener('click', async (e) => {
	const btn = e.target.closest('.hub-sticker-item')
	if (!btn) return
	if (!currentAIChatId && (!currentGroupId || !currentChannelId)) return
	const stickerId = btn.dataset.stickerId
	const stickerUrl = btn.dataset.stickerUrl
	const tag = stickerUrl
    ? `[sticker:${stickerId}|${stickerUrl}]`
    : `[sticker:${stickerId}]`
	document.getElementById('sticker-picker').classList.remove('show')
	try {
		await sendCurrentMessage(tag)
	} catch (err) {
		alert('发送贴纸失败: ' + err.message)
	}
})

// ============ 添加群组按钮（自定义弹窗替代原生 confirm） ============
/**
 *
 */
function showServerActionPicker() {
	const modal = document.createElement('dialog')
	modal.className = 'modal'
	modal.innerHTML = `

<div class="modal-box sap-box">
<div class="sap-header">
<h3>开始你的群组之旅</h3>
<p>创建一个新群组，或通过 ID 加入已有群组</p>
</div>
<div class="sap-body">
<div class="sap-card" data-action="create">
<div class="sap-card-icon">✨</div>
<div class="sap-card-title">创建群组</div>
<div class="sap-card-desc">从零开始<br/>邀请好友加入</div>
</div>
<div class="sap-card" data-action="join">
<div class="sap-card-icon">🔗</div>
<div class="sap-card-title">加入群组</div>
<div class="sap-card-desc">通过群组 ID<br/>加入已有群组</div>
</div>
</div>
<div class="sap-footer">
<button class="sap-btn-cancel" data-cancel>取消</button>
</div>
</div>
<form method="dialog" class="modal-backdrop"><button>关闭</button></form>
`
	modal.querySelector('[data-action="create"]').addEventListener(
		'click',
		() => {
			modal.close()
			modal.remove()
			showCreateGroupModal()
		},
	)
	modal.querySelector('[data-action="join"]').addEventListener('click', () => {
		modal.close()
		modal.remove()
		joinGroupById()
	})
	modal.querySelector('[data-cancel]').addEventListener('click', () => {
		modal.close()
		modal.remove()
	})
	document.body.appendChild(modal)
	modal.showModal()
}

document.getElementById('add-server-btn').addEventListener(
	'click',
	showServerActionPicker,
)

// ============ 切换成员栏 ============
document.getElementById('toggle-members-btn').addEventListener('click', () => {
	const bar = document.getElementById('member-bar')
	bar.style.display = bar.style.display === 'none' ? '' : 'none'
})

// ============ 搜索（实时过滤当前消息） ============
document.getElementById('header-search').addEventListener('input', (e) => {
	const q = e.target.value.trim().toLowerCase()
	document.querySelectorAll(
		'#messages .hub-message, #messages .hub-system-message',
	).forEach((el) => {
		if (!q) {
			el.style.display = ''
			return
		}
		const text = (el.textContent || '').toLowerCase()
		el.style.display = text.includes(q) ? '' : 'none'
	})
})
document.getElementById('header-search').addEventListener('focus', (e) => {
	e.target.style.borderColor = 'var(--hub-accent)'
})
document.getElementById('header-search').addEventListener('blur', (e) => {
	e.target.style.borderColor = 'transparent'
})

// ============ 设置按钮（在页内弹出模态框，按当前上下文路由） ============
document.getElementById('header-settings-btn').addEventListener('click', () => {
	if (currentGroupId) openGroupSettingsModal(currentGroupId)
	else if (currentAIChatId) openAIChatSettingsModal(currentAIChatId)
	else window.open('/parts/shells:chat/profile', '_blank', 'noopener')
})

// ============ 群组头部点击打开设置（在页内弹窗） ============
document.getElementById('group-header').addEventListener('click', () => {
	if (currentGroupId) openGroupSettingsModal(currentGroupId)
})

// ============ 用户栏点击打开个人资料 ============
document.getElementById('user-bar').addEventListener('click', () => {
	window.location.href = '/parts/shells:chat/profile'
})

// ============================================================
// 模式切换 (AI 角色 / 频道 / 群组)
// ============================================================
let currentMode = 'groups' // 默认群组模式
let charsCache = null

/**
 * 高亮左侧模式切换按钮（群组 / 频道 / AI）。
 * @param {'groups'|'chars'} mode - 模式标识
 * @returns {void} 无
 */
function setActiveModeTab(mode) {
	document.querySelectorAll('.hub-server-item[data-mode]').forEach((el) => {
		el.classList.toggle('mode-active', el.dataset.mode === mode)
	})
}

/**
 * 拉取已安装角色列表并缓存。
 * @returns {Promise<string[]>} 角色名数组
 */
async function loadCharsList() {
	if (charsCache) return charsCache
	try {
		const resp = await fetch('/api/getlist/chars', { credentials: 'include' })
		if (!resp.ok) return charsCache = []
		const list = await resp.json()
		charsCache = Array.isArray(list) ? list : []
		return charsCache
	} catch {
		return charsCache = []
	}
}

/**
 * 拉取单个角色的详情 JSON。
 * @param {string} name - 角色名
 * @returns {Promise<Object|null>} 详情对象；失败为 null
 */
async function getCharDetails(name) {
	try {
		const resp = await fetch(
			`/api/getdetails/chars/${encodeURIComponent(name)}`,
			{ credentials: 'include' },
		)
		if (!resp.ok) return null
		return await resp.json()
	} catch {
		return null
	}
}

/**
 * 在左侧栏渲染 AI 角色列表。
 * @param {string[]} items - 角色名列表
 * @returns {void} 无
 */
function renderCharsColumn(items) {
	const header = document.getElementById('group-name-display')
	const container = document.getElementById('channel-list')
	header.textContent = 'AI 角色'
	if (!items.length) {
		container.innerHTML =
      '<div class="hub-list-loading">暂无角色，先去安装一些吧</div>'
		return
	}
	container.innerHTML = `
<div class="hub-category"><span style="margin-left:4px;">${items.length} 个角色</span></div>
${
	items.map((name) => `
<div class="hub-channel-item hub-list-item-char" data-char="${
	escapeHtml(name)
}" title="${escapeHtml(name)}">
<svg class="hub-channel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<circle cx="12" cy="8" r="4"/>
<path d="M4 21v-1a8 8 0 0 1 16 0v1"/>
</svg>
<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${
	escapeHtml(name)
}</span>
</div>
`).join('')
}
`
	container.querySelectorAll('.hub-channel-item').forEach((el) => {
		el.addEventListener('click', () => {
			const name = el.dataset.char
			// 在页内进入 1:1 AI 聊天
			enterAIChat(name)
		})
		el.addEventListener('mouseenter', async () => {
			if (currentAIChatId) return // 已在聊天中不覆盖右栏
			const name = el.dataset.char
			const details = await getCharDetails(name)
			await renderCharInfoCard(name, details)
		})
	})

	// 默认显示第一个角色的信息卡（如果有 且 未在聊天中）
	if (items[0] && !currentAIChatId) 
		getCharDetails(items[0]).then((d) => renderCharInfoCard(items[0], d))
  
}

// AI 角色嵌入聊天（1:1 完整功能：创建/加载会话 + WS 实时回复）
/**
 *
 */
function closeAIChatWs() {
	if (aiChatWs) {
		try {
			aiChatWs.close()
		} catch {}
		aiChatWs = null
	}
}

/**
 *
 */
function clearAIChatState() {
	closeAIChatWs()
	currentAIChatId = null
	currentAIChar = null
	aiChatLogLength = 0
	streamingEntries.clear()
}

// 清理 AI 回复中的 Markdown 格式符号（*、**、_、__、~~ 等）
/**
 * 去除 AI 回复中常见 Markdown 强调符号，便于纯文本展示。
 * @param {string} [text] - 原始 AI 文本
 * @returns {string|undefined} 清理后的文本；空输入原样返回
 */
function cleanAIText(text) {
	if (!text) return text
	// 去掉成对的 ** / * / __ / _ / ~~（保留中间文字）
	let cleaned = text
	cleaned = cleaned.replace(/\*\*(.+?)\*\*/g, '$1')
	cleaned = cleaned.replace(/\*(.+?)\*/g, '$1')
	cleaned = cleaned.replace(/__(.+?)__/g, '$1')
	cleaned = cleaned.replace(/_(.+?)_/g, '$1')
	cleaned = cleaned.replace(/~~(.+?)~~/g, '$1')
	// 去掉残余的孤立 * 号
	cleaned = cleaned.replace(/\*/g, '')
	return cleaned
}

// 将服务器推送的 stream_update slices 应用到本地追踪的流式内容上
/**
 * 根据 WS 推送的 slice 列表就地更新流式消息追踪对象。
 * @param {{content?: string, content_for_show?: string, files?: Array}} tracked - 本地追踪条目（可变）
 * @param {Array<Object>} slices - 服务器下发的增量片段
 * @returns {void} 无
 */
function applyStreamSlices(tracked, slices) {
	for (const slice of slices) 
		if (slice.type === 'append') {
			// slice.add = { content?: '...', content_for_show?: '...' }
			if (slice.add.content != null) tracked.content += slice.add.content
			if (slice.add.content_for_show != null) 
				tracked.content_for_show += slice.add.content_for_show
      
		} else if (slice.type === 'rewrite_tail') {
			const field = slice.field || 'content'
			if (field === 'content') 
				tracked.content = tracked.content.slice(0, slice.index) + slice.content
			else if (field === 'content_for_show') 
				tracked.content_for_show =
          tracked.content_for_show.slice(0, slice.index) + slice.content
      
		} else if (slice.type === 'set_files') 
			tracked.files = slice.files || []
    
  
}

// 增量更新流式消息的 DOM
/**
 * 将追踪对象中的最新文本写回对应消息 DOM，并按需滚动到底部。
 * @param {{index: number, content?: string, content_for_show?: string, files?: Array}} tracked - 流式追踪条目
 * @returns {void} 无
 */
function updateStreamingEntryDOM(tracked) {
	const container = document.getElementById('messages')
	const el = container.querySelector(`[data-message-id="ai-${tracked.index}"]`)
	if (!el) return
	const contentEl = el.querySelector('.hub-message-content')
	if (!contentEl) return
	const displayText = tracked.content || ''
	const filesHtml = (tracked.files || []).map((f) => {
		const mime = f.mime_type || ''
		if (mime.startsWith('image/') && f.buffer) 
			return `<img src="data:${mime};base64,${f.buffer}" alt="${
				escapeHtml(f.name || '')
			}" style="max-width:380px;max-height:300px;border-radius:6px;display:block;margin-top:6px;" />`
    
		return `<a href="#" class="hub-file-tag">${
			escapeHtml(f.name || 'file')
		}</a>`
	}).join('')
	contentEl.innerHTML = renderMessageContent(cleanAIText(displayText)) +
    filesHtml
	const nearBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight < 120
	if (forceScrollOnNext || nearBottom) scrollToBottom()
}

/**
 * 渲染单条 AI 会话日志条目为消息气泡 HTML。
 * @param {Object} entry - 日志条目（角色、内容、附件等）
 * @param {number} index - 在日志中的序号（用于 data-message-id）
 * @returns {string} 单条消息的 HTML 字符串
 */
function renderAIEntry(entry, index) {
	const role = entry.role || (entry.name === myUsername ? 'user' : 'char')
	const author = entry.name ||
    (role === 'user' ? myUsername || '我' : currentAIChar || 'AI')
	const time = entry.time_stamp
    ? new Date(entry.time_stamp).getTime()
    : Date.now()
	const rawText = entry.content || ''
	const text = role !== 'user' ? cleanAIText(rawText) : rawText
	const avatarUrl = entry.avatar || ''
	const filesHtml = (entry.files || []).map((f) => {
		const mime = f.mime_type || ''
		if (mime.startsWith('image/') && f.buffer) 
			return `<img src="data:${mime};base64,${f.buffer}" alt="${
				escapeHtml(f.name || '')
			}" style="max-width:380px;max-height:300px;border-radius:6px;display:block;margin-top:6px;" />`
    
		return `<a href="#" class="hub-file-tag">${
			escapeHtml(f.name || 'file')
		}</a>`
	}).join('')
	const generating = entry.is_generating
    ? '<span class="hub-typing-inline" style="margin-left:6px;color:var(--hub-text-muted);font-size:12px;">正在输入...</span>'
    : ''
	return `
<div class="hub-message first-in-group hub-ai-entry" data-message-id="ai-${index}" data-role="${role}">
<div class="hub-avatar" data-avatar-for="${
	escapeHtml(author)
}" style="background:${avatarColor(author)};">
${
    avatarUrl
      ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(author)}" />`
      : escapeHtml(avatarInitial(author))
}
</div>
<div class="hub-message-body">
<div class="hub-message-header">
<span class="hub-message-author">${escapeHtml(author)}</span>
<span class="hub-message-time">${formatTime(time)}</span>
${generating}
</div>
<div class="hub-message-content">${renderMessageContent(text)}${filesHtml}</div>
</div>
</div>
`
}

/**
 * 将 AI 聊天日志整体渲染进消息容器（含空状态）。
 * @param {Array<Object>} entries - 日志条目数组
 * @returns {void} 无
 */
function renderAIChatLog(entries) {
	const container = document.getElementById('messages')
	if (!entries.length) {
		container.innerHTML = `
<div class="hub-empty">
<div class="hub-empty-icon">👋</div>
<div style="color:var(--hub-text-bright);font-size:18px;font-weight:600;margin-bottom:8px;">和 ${
	escapeHtml(currentAIChar)
} 开始对话</div>
<div>暂无消息，开始你的第一条聊天吧！</div>
</div>
`
		return
	}
	container.innerHTML = entries.map((entry, index) => renderAIEntry(entry, index)).join('')
	applyAvatarsTo(container)
	scrollToBottom()
}

/**
 *
 */
async function loadAIChatLog() {
	if (!currentAIChatId) return
	const lenResp = await fetch(
		`/api/parts/shells:chat/groups/${currentAIChatId}/log/length`,
		{ credentials: 'include' },
	)
	const length = lenResp.ok ? await lenResp.json() : 0
	aiChatLogLength = length
	if (!length) {
		renderAIChatLog([])
		return
	}
	const start = Math.max(0, length - 100)
	const resp = await fetch(
		`/api/parts/shells:chat/groups/${currentAIChatId}/log?start=${start}&end=${length}`,
		{ credentials: 'include' },
	)
	if (!resp.ok) {
		document.getElementById('messages').innerHTML =
      '<div class="hub-empty"><div style="color:#ed4245">加载消息失败</div></div>'
		return
	}
	const entries = await resp.json()
	renderAIChatLog(entries || [])
}

/**
 * 在消息列表末尾追加一条 AI 日志条目并维护流式状态。
 * @param {Object} entry - 新增日志条目
 * @returns {void} 无
 */
function appendAIEntry(entry) {
	const container = document.getElementById('messages')
	const empty = container.querySelector('.hub-empty')
	if (empty) container.innerHTML = ''
	const nearBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight < 120
	const thisIndex = aiChatLogLength
	container.insertAdjacentHTML('beforeend', renderAIEntry(entry, thisIndex))
	applyAvatarsTo(container)
	aiChatLogLength++
	// 如果是 AI 正在生成的占位消息，注册到流式追踪表
	if (entry.is_generating && entry.id) 
		streamingEntries.set(entry.id, {
			index: thisIndex,
			content: entry.content || '',
			content_for_show: entry.content_for_show || '',
			files: entry.files || [],
		})
  
	// 用户主动发送 → 强制滚动；同时，刚发送后 AI 推送的回复也应强制滚动一次，
	// 避免用户看到自己消息但需要手滑才能看见 AI 回复。
	const isOwnEntry = entry?.role === 'user' || entry?.author === myUsername
	if (forceScrollOnNext || nearBottom) {
		scrollToBottom()
		// 用户消息渲染后保留 flag 直到 AI 回复也滚一次
		if (!isOwnEntry) forceScrollOnNext = false
	}
}

/**
 * 按序号替换已有 AI 消息节点；不存在则退化为追加。
 * @param {number} index - 日志序号
 * @param {Object} entry - 替换后的条目内容
 * @returns {void} 无
 */
function replaceAIEntry(index, entry) {
	const container = document.getElementById('messages')
	const el = container.querySelector(`[data-message-id="ai-${index}"]`)
	if (!el) {
		appendAIEntry(entry)
		return
	}
	const nearBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight < 120
	const wrap = document.createElement('div')
	wrap.innerHTML = renderAIEntry(entry, index)
	el.replaceWith(wrap.firstElementChild)
	applyAvatarsTo(container)
	if (forceScrollOnNext || nearBottom) {
		scrollToBottom()
		forceScrollOnNext = false
	}
}

/**
 * 在输入框上方展示「正在输入」提示条。
 * @param {string[]} [typingList] - 正在输入的角色名列表
 * @returns {void} 无
 */
function setTypingStatus(typingList) {
	let bar = document.getElementById('ai-typing-bar')
	if (!typingList || !typingList.length) {
		if (bar) bar.remove()
		return
	}
	if (!bar) {
		bar = document.createElement('div')
		bar.id = 'ai-typing-bar'
		bar.style.cssText =
      'padding:6px 16px;color:var(--hub-text-muted);font-size:13px;font-style:italic;background:var(--hub-bg-floating);border-top:1px solid var(--hub-border);'
		const composer = document.querySelector('.hub-composer')
		composer.parentNode.insertBefore(bar, composer)
	}
	bar.textContent = `${typingList.join(', ')} 正在输入...`
}

/**
 * 为指定 AI 会话组建立 WebSocket 并处理推送事件。
 * @param {string} groupId - 会话组 ID
 * @returns {void} 无
 */
function connectAIChatWs(groupId) {
	closeAIChatWs()
	const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
	const ws = new WebSocket(
		`${proto}//${location.host}/ws/parts/shells:chat/groups/${
			encodeURIComponent(groupId)
		}`,
	)
	aiChatWs = ws
	ws.addEventListener('message', (ev) => {
		let data
		try {
			data = JSON.parse(ev.data)
		} catch {
			return
		}
		if (currentAIChatId !== groupId) return
		switch (data.type) {
			case 'message_added':
				appendAIEntry(data.payload)
				break
			case 'message_replaced':
				// 流式结束后的最终替换，清理追踪状态
				if (data.payload.entry?.id) 
					streamingEntries.delete(data.payload.entry.id)
        
				replaceAIEntry(data.payload.index, data.payload.entry)
				break
			case 'message_deleted':
				{
					const el = document.querySelector(
						`[data-message-id="ai-${data.payload.index}"]`,
					)
					if (el) el.remove()
				}
				break
			case 'typing_status':
				setTypingStatus(data.payload?.typingList || [])
				break
			case 'stream_update':
				{
					const { messageId, slices } = data.payload || {}
					const tracked = messageId && streamingEntries.get(messageId)
					if (tracked && Array.isArray(slices)) {
						applyStreamSlices(tracked, slices)
						updateStreamingEntryDOM(tracked)
					}
				}
				break
		}
	})
	ws.addEventListener('close', () => {
		if (aiChatWs === ws) aiChatWs = null
	})
}

/**
 * 在会话列表中查找与指定角色关联的最近会话组 ID。
 * @param {string} charname - 角色名
 * @returns {Promise<string|null>} 匹配的 `groupId`；无则 null
 */
async function findExistingChatForChar(charname) {
	try {
		const resp = await fetch('/api/parts/shells:chat/groups/list', {
			credentials: 'include',
		})
		if (!resp.ok) return null
		const list = await resp.json()
		if (!Array.isArray(list)) return null
		// chat list returns summaries; find latest matching this char
		const matches = list.filter((s) =>
      Array.isArray(s.chars)
        ? s.chars.includes(charname)
        : s.chars && Object.keys(s.chars).includes(charname)
		)
		if (!matches.length) return null
		matches.sort((a, b) =>
			new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0)
		)
		return matches[0].groupId
	} catch {
		return null
	}
}

/**
 * 进入与指定 AI 角色的 1:1 聊天：解析/创建会话、连接 WS、加载日志与侧栏。
 * @param {string} charname - 角色名
 * @param {{groupId?: string, forceNew?: boolean}} [opts] - 可选：指定已有会话或强制新建
 * @returns {Promise<void>} 异步完成后无返回值
 */
async function enterAIChat(charname, opts = {}) {
	if (!charname) return
	// 清理其他模式
	currentGroupId = null
	currentChannelId = null
	currentState = null
	if (pollTimer) {
		clearInterval(pollTimer)
		pollTimer = null
	}
	closeAIChatWs()

	currentAIChar = charname
	currentMode = 'chars'
	setActiveModeTab('chars')
	document.getElementById('channel-name-display').textContent = charname
	document.getElementById('messages').innerHTML =
    '<div class="hub-empty"><div class="loading loading-spinner"></div></div>'

	// 确定 groupId：opts.groupId > URL hash（仅 `#group:…`）> 复用最近 > 新建
	let groupId = opts.groupId
	if (!groupId) {
		const hashRaw = window.location.hash.slice(1)
		if (hashRaw.startsWith('group:')) {
			const rest = hashRaw.slice('group:'.length).split(':')
			if (rest[0]) groupId = rest[0]
		}
	}
	if (!groupId && !opts.forceNew) 
		groupId = await findExistingChatForChar(charname)
  

	let needAddChar = false
	if (!groupId) 
		try {
			const r = await fetch('/api/parts/shells:chat/groups/new', {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			})
			if (!r.ok) throw new Error(`HTTP ${r.status}`)
			const data = await r.json()
			groupId = data.groupId
			needAddChar = true
		} catch (e) {
			document.getElementById('messages').innerHTML =
        `<div class="hub-empty"><div style="color:#ed4245">创建会话失败：${
        	escapeHtml(e.message)
        }</div></div>`
			return
		}
	else 
	// 检查是否已经包含该角色
		try {
			const cr = await fetch(`/api/parts/shells:chat/groups/${groupId}/chars`, {
				credentials: 'include',
			})
			const chars = cr.ok ? await cr.json() : []
			if (Array.isArray(chars) && !chars.includes(charname)) needAddChar = true
		} catch {
			needAddChar = true
		}
  

	currentAIChatId = groupId
	window.history.replaceState(
		null,
		'',
		`${location.pathname}${location.search}#group:${groupId}:default`,
	)

	if (needAddChar) 
		try {
			await fetch(`/api/parts/shells:chat/groups/${groupId}/char`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ charname }),
			})
		} catch { /* 角色加入失败时仍可继续 */ }
  

	// 启用输入并连接 WS
	enableComposer()
	document.getElementById('message-input').placeholder =
    `给 ${charname} 发送消息（Enter 发送，Ctrl+Enter 换行）`
	connectAIChatWs(groupId)
	await loadAIChatLog()

	// 右栏角色信息卡 + AI 介绍
	const details = await getCharDetails(charname).catch(() => null)
	renderCharInfoCardActive(charname, details)
}

/**
 * 在侧栏渲染「当前聊天中」角色的信息卡与参与者列表。
 * @param {string} name - 角色名
 * @param {Object|null} [details] - `getCharDetails` 返回的详情
 * @returns {Promise<void>} 异步完成后无返回值
 */
async function renderCharInfoCardActive(name, details) {
	const host = document.getElementById('info-card-host')
	const info = details?.info || {}
	const desc = info.description || info.summary || details?.description ||
    '这个角色还没有自我介绍。'
	const avatarUrl = info.avatar || details?.avatar || ''
	const memberList = document.getElementById('member-list')
	memberList.innerHTML = `
<div class="hub-member-group-title">AI 介绍</div>
<div style="padding: 0 16px 12px; color: var(--hub-text-normal); font-size: 13px; line-height: 1.55; white-space: pre-wrap;">${
	escapeHtml(desc)
}</div>
<div class="hub-member-group-title">参与者</div>
<div class="hub-member-item" title="${escapeHtml(name)}">
<div class="hub-member-avatar-wrap">
<div class="hub-member-avatar" data-avatar-for="${
	escapeHtml(name)
}" style="background:${avatarColor(name)};">
${
    avatarUrl
      ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name)}" />`
      : escapeHtml(avatarInitial(name))
}
</div>
<span class="hub-presence-dot hub-presence-online" title="在线"></span>
</div>
<div class="hub-member-name">${escapeHtml(name)}</div>
</div>
${
    myUsername
      ? `
<div class="hub-member-item" title="${escapeHtml(myUsername)}">
<div class="hub-member-avatar-wrap">
<div class="hub-member-avatar" data-avatar-for="${
        escapeHtml(myUsername)
      }" style="background:${avatarColor(myUsername)};">${
      	escapeHtml(avatarInitial(myUsername))
      }</div>
<span class="hub-presence-dot hub-presence-online" title="在线"></span>
</div>
<div class="hub-member-name">${escapeHtml(myUsername)}</div>
</div>
`
      : ''
}
`
	host.innerHTML = `
<div class="hub-info-card">
<div class="hub-info-banner"></div>
<div class="hub-info-body">
<div class="hub-info-avatar" style="background:${avatarColor(name)};">
${
    avatarUrl
      ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name)}" />`
      : escapeHtml(avatarInitial(name))
}
</div>
<div class="hub-info-name">${escapeHtml(name)}</div>
<span class="hub-info-tag">AI 角色 · 1:1 对话</span>
<div class="hub-info-desc" style="margin-top:8px;">${
	escapeHtml(desc.length > 200 ? desc.slice(0, 200) + '…' : desc)
}</div>
</div>
</div>
`
	applyAvatarsTo(memberList)
}

/**
 * 向当前 AI 会话发送一条用户消息（由服务端触发自动回复）。
 * @param {string} content - 用户输入正文
 * @returns {Promise<void>} 请求完成后无返回值；失败抛错
 */
async function sendAIChatMessage(content) {
	if (!currentAIChatId || !currentAIChar) throw new Error('未选择 AI 角色')
	const r = await fetch(`/api/parts/shells:chat/groups/${currentAIChatId}/message`, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ reply: { content } }),
	})
	if (!r.ok) {
		const data = await r.json().catch(() => ({}))
		throw new Error(data?.error || `HTTP ${r.status}`)
	}
	// 注意：服务器在 addUserReply -> handleAutoReply 中已自动触发回复，
	// 不需要再调用 trigger-reply，否则会导致 AI 回复两次。
}

/**
 * 在侧栏展示角色简介预览与「开始聊天」入口（未进入会话时）。
 * @param {string} name - 角色名
 * @param {Object|null} [details] - 角色详情 JSON
 * @returns {Promise<void>} 异步完成后无返回值
 */
async function renderCharInfoCard(name, details) {
	const host = document.getElementById('info-card-host')
	const info = details?.info || {}
	const desc = info.description || info.summary || details?.description ||
    '这个角色还没有自我介绍。'
	const avatarUrl = info.avatar || details?.avatar || ''
	const memberList = document.getElementById('member-list')
	memberList.innerHTML = `<div class="hub-member-group-title">AI 介绍</div>
<div style="padding: 0 16px 12px; color: var(--hub-text-normal); font-size: 13px; line-height: 1.55; white-space: pre-wrap;">${
	escapeHtml(desc)
}</div>`
	host.innerHTML = `
<div class="hub-info-card">
<div class="hub-info-banner"></div>
<div class="hub-info-body">
<div class="hub-info-avatar" style="background:${avatarColor(name)};">
${
    avatarUrl
      ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name)}" />`
      : escapeHtml(avatarInitial(name))
}
</div>
<div class="hub-info-name">${escapeHtml(name)}</div>
<span class="hub-info-tag">AI 角色</span>
<button class="hub-info-cta" data-char="${
	escapeHtml(name)
}" style="margin-top:12px;width:100%;background:#5865f2;color:white;border:none;padding:9px 14px;border-radius:6px;font-weight:600;cursor:pointer;font-size:14px;transition:background 0.15s;">
💬 开始与 ${escapeHtml(name)} 聊天
</button>
</div>
</div>
`
	const cta = host.querySelector('.hub-info-cta')
	if (cta) {
		cta.addEventListener('mouseenter', () => cta.style.background = '#4752c4')
		cta.addEventListener('mouseleave', () => cta.style.background = '#5865f2')
		cta.addEventListener('click', () => enterAIChat(name))
	}
}

/**
 * 在右侧信息卡渲染当前群组的名称与简介。
 * @param {Object} [state] - `getGroupState` 返回的群组状态
 * @returns {void} 无
 */
function renderGroupInfoCard(state) {
	const host = document.getElementById('info-card-host')
	const meta = state?.groupMeta || {}
	const desc = meta.description || '这个群组还没有简介。'
	host.innerHTML = `
<div class="hub-info-card">
<div class="hub-info-banner"></div>
<div class="hub-info-body">
<div class="hub-info-avatar" style="background:${
	avatarColor(meta.name || '?')
};">
${escapeHtml(avatarInitial(meta.name || '?'))}
</div>
<div class="hub-info-name">${escapeHtml(meta.name || '群组')}</div>
<span class="hub-info-tag">群组</span>
<div class="hub-info-desc" style="margin-top:8px;">${escapeHtml(desc)}</div>
</div>
</div>
`
}

/**
 * 切换 Hub 顶层模式（群组 / AI 角色）并重绘侧栏。
 * @param {'groups'|'chars'} mode - 目标模式
 * @returns {Promise<void>} 异步加载列表并更新 UI
 */
async function setMode(mode) {
	currentMode = mode
	setActiveModeTab(mode)
	const container = document.getElementById('channel-list')
	container.innerHTML = '<div class="hub-list-loading">加载中...</div>'
	document.getElementById('member-list').innerHTML = ''
	document.getElementById('info-card-host').innerHTML = ''

	if (mode === 'chars') {
		setHubPinsBookmarksWrapVisible(false)
		const pb = document.getElementById('hub-plaintext-main-banner')
		if (pb) {
			pb.setAttribute('hidden', '')
			pb.textContent = ''
		}
	}

	const keepAISession = mode === 'chars' && currentAIChatId
	if (!keepAISession) 
		if (pollTimer) {
			clearInterval(pollTimer)
			pollTimer = null
		}
	
	if (!keepAISession) clearAIChatState()
	if (mode === 'chars' && !keepAISession) {
		disableComposer('选择一个 AI 角色开始聊天...')
		document.getElementById('messages').innerHTML =
      '<div class="hub-empty"><div class="hub-empty-icon">🤖</div><div style="color:var(--hub-text-bright);font-size:18px;font-weight:600;margin-bottom:8px;">AI 角色</div><div>从左侧列表选择一个 AI 角色开始对话</div></div>'
		document.getElementById('channel-name-display').textContent = 'AI 角色'
	}

	if (mode === 'chars') {
		const list = await loadCharsList()
		renderCharsColumn(list)
	}
	else if (mode === 'groups') 
		if (!currentGroupId || !currentState) {
			setHubPinsBookmarksWrapVisible(false)
			updateHubPlaintextMainBanner()
			container.innerHTML =
        '<div class="hub-list-loading">← 选择左侧的服务器</div>'
		}
		else {
			renderChannelList(currentState)
			renderMemberList(currentState)
			renderGroupInfoCard(currentState)
		}
	
}

document.querySelectorAll('.hub-server-item[data-mode]').forEach((el) => {
	el.addEventListener('click', () => setMode(el.dataset.mode))
})

// 暴露给 selectGroup 调用，作为副作用钩子
/**
 * 选中群组后的回调：同步模式 Tab 并刷新群组信息卡。
 * @param {Object|null} [state] - 当前群组状态；无则仅切 Tab
 * @returns {void} 无
 */
window.__hubAfterSelectGroup = (state) => {
	currentMode = 'groups'
	setActiveModeTab('groups')
	if (state) renderGroupInfoCard(state)
}

// ============================================================
// Profile hover card
// ============================================================
const hoverCard = document.getElementById('profile-hover-card')
let hoverCardHideTimer = null

/**
 * 在鼠标锚点附近展示用户资料悬浮卡并异步加载头像与在线状态。
 * @param {string} username - 目标用户名
 * @param {HTMLElement} anchorEl - 用于定位的锚点元素
 * @returns {Promise<void>} 异步加载完成后无返回值
 */
async function showHoverCardFor(username, anchorEl) {
	if (!username) return
	clearTimeout(hoverCardHideTimer)
	// 避免同一个目标重复触发：若卡片已在显示且用户名一致，则跳过
	if (
		hoverCard.classList.contains('show') && hoverCard.dataset.uname === username
	) return
	hoverCard.dataset.uname = username
	const rect = anchorEl.getBoundingClientRect()
	let left = rect.right + 8
	let top = rect.top
	if (left + 280 > window.innerWidth) left = rect.left - 288
	if (top + 320 > window.innerHeight) top = window.innerHeight - 330
	if (top < 8) top = 8
	hoverCard.style.left = left + 'px'
	hoverCard.style.top = top + 'px'

	document.getElementById('hc-name').textContent = username
	document.getElementById('hc-avatar-letter').textContent = avatarInitial(
		username,
	)
	document.getElementById('hc-avatar').style.background = avatarColor(username)
	document.getElementById('hc-avatar').dataset.uname = username
	document.getElementById('hc-bio').textContent = '加载中...'

	hoverCard.classList.add('show')

	// 异步加载头像 + 在线状态
	const [avatar, statuses] = await Promise.all([
		fetchUserAvatar(username),
		fetchBulkPresence([username]),
	])
	if (document.getElementById('hc-avatar').dataset.uname !== username) return
	if (avatar) 
		document.getElementById('hc-avatar').innerHTML = `<img src="${
			escapeHtml(avatar)
		}" alt=""/><span class="hub-hc-presence-dot" id="hc-presence"></span>`
  
	const status = statuses[username]?.status || 'offline'
	const dot = document.getElementById('hc-presence')
	if (dot) {
		dot.classList.remove('online', 'idle')
		if (status === 'online' || status === 'idle') dot.classList.add(status)
	}
	document.getElementById('hc-status').textContent = PRESENCE_LABEL[status] ||
    '离线'
	document.getElementById('hc-bio').textContent = '这位用户暂无简介。'
}

/**
 *
 */
function hideHoverCard() {
	clearTimeout(hoverCardHideTimer)
	hoverCardHideTimer = setTimeout(() => {
		hoverCard.classList.remove('show')
		delete hoverCard.dataset.uname
	}, 220)
}

hoverCard.addEventListener('mouseenter', () => clearTimeout(hoverCardHideTimer))
hoverCard.addEventListener('mouseleave', hideHoverCard)

/**
 * 从事件目标元素解析应关联的用户名（头像、作者名、成员行等）。
 * @param {EventTarget|null} target - DOM 事件目标或子节点
 * @returns {string|null} 有效用户名；无法解析则为 null
 */
function getAnchorUsername(target) {
	if (!target) return null
	let uname = target.dataset.avatarFor
	if (!uname) 
		if (
			target.classList.contains('hub-message-author') ||
      target.classList.contains('hub-system-author')
		) 
			uname = target.textContent.trim()
		else if (target.classList.contains('hub-member-item')) 
			uname = target.querySelector('[data-avatar-for]')?.dataset.avatarFor
    
  
	return uname && uname !== '?' ? uname : null
}

document.addEventListener('mouseover', (e) => {
	const target = e.target.closest(
		'[data-avatar-for], .hub-message-author, .hub-member-item, .hub-system-author',
	)
	if (!target) return
	// 如果鼠标从同一个 anchor 的内部子元素之间移动，relatedTarget 仍在 target 内 → 跳过
	if (target.contains(e.relatedTarget)) return
	const uname = getAnchorUsername(target)
	if (uname) showHoverCardFor(uname, target)
})
document.addEventListener('mouseout', (e) => {
	const target = e.target.closest(
		'[data-avatar-for], .hub-message-author, .hub-member-item, .hub-system-author',
	)
	if (!target) return
	// 鼠标仍在 target 内移动（移到子元素），不要隐藏
	if (target.contains(e.relatedTarget)) return
	// 鼠标移到了悬浮卡上，不要隐藏
	if (hoverCard.contains(e.relatedTarget)) return
	hideHoverCard()
})

// ============================================================
// 设置弹窗：通用打开/关闭工具
// ============================================================
const ovlModal = document.getElementById('hub-settings-modal')

/**
 * 打开通用设置浮层并写入标题、副标题、主体与底部栏。
 * @param {Object} root0 - 解构传入的模态内容对象
 * @param {string} [root0.title] - 主标题
 * @param {string} [root0.subtitle] - 副标题
 * @param {string} [root0.body] - 主体 HTML
 * @param {string} [root0.footer] - 底部操作区 HTML
 * @returns {void} 无
 */
function openOvlModal({ title, subtitle, body, footer }) {
	document.getElementById('ovl-title').textContent = title || '设置'
	document.getElementById('ovl-subtitle').textContent = subtitle || ''
	document.getElementById('ovl-body').innerHTML = body || ''
	document.getElementById('ovl-footer').innerHTML = footer || ''
	if (!ovlModal.open) ovlModal.showModal()
}
/**
 *
 */
function closeOvlModal() {
	try {
		ovlModal.close()
	} catch {}
}
/**
 * 在设置浮层主体顶部展示成功或错误提示文案。
 * @param {'error'|'success'} type - 提示类型
 * @param {string} text 展示给用户的说明文字
 * @returns {void} 无
 */
function showOverlayNotice(type, text) {
	const body = document.getElementById('ovl-body')
	const cls = type === 'error' ? 'ovl-error' : 'ovl-success'
	let host = body.querySelector(`.${cls}`)
	if (!host) {
		host = document.createElement('div')
		host.className = cls
		body.prepend(host)
	}
	host.textContent = text
	host.style.display = 'block'
	if (type === 'success') 
		setTimeout(() => {
			host.style.display = 'none'
		}, 2500)
  
}

// ============================================================
// AI 角色聊天设置弹窗
// ============================================================
/**
 * 打开当前 AI 1:1 会话的设置浮层（删除等）。
 * @param {string} groupId - 会话组 ID
 * @returns {Promise<void>} 绑定事件后无返回值
 */
async function openAIChatSettingsModal(groupId) {
	const charname = currentAIChar || '?'
	openOvlModal({
		title: 'AI 聊天设置',
		subtitle: `与 ${charname} 的会话`,
		body: `
<div class="ovl-section">
<h4>会话信息</h4>
<div class="ovl-info-row"><span>角色</span><span>${
	escapeHtml(charname)
}</span></div>
<div class="ovl-info-row"><span>会话 ID</span><span>${
	escapeHtml(groupId)
}</span></div>
<div class="ovl-info-row"><span>消息数</span><span>${aiChatLogLength}</span></div>
</div>
<div class="ovl-section">
<h4>快捷操作</h4>
<div class="ovl-toggle-row" id="aics-advanced" style="cursor:pointer;">
<div>
<div class="ovl-tr-title">高级设置（角色 / 世界 / 插件）</div>
<div class="ovl-tr-desc">在新标签页打开 Hub 中该群的完整设置</div>
</div>
<span style="color:#5865f2;">↗</span>
</div>
</div>
<div class="ovl-section">
<h4>危险区域</h4>
<div style="font-size:13px;color:#949ba4;margin-bottom:8px;">删除此会话将永久移除所有消息，此操作不可恢复。</div>
</div>
`,
		footer: `
<button class="ovl-btn ovl-btn-danger" id="aics-delete">删除会话</button>
<button class="ovl-btn ovl-btn-cancel" id="aics-close">关闭</button>
`,
	})
	document.getElementById('aics-close').addEventListener(
		'click',
		closeOvlModal,
	)
	document.getElementById('aics-advanced').addEventListener('click', () => {
		window.open(
			`/parts/shells:chat/hub/#group:${encodeURIComponent(groupId)}:default`,
			'_blank',
			'noopener',
		)
	})
	document.getElementById('aics-delete').addEventListener('click', async () => {
		if (!confirm(`确认删除与 ${charname} 的会话？此操作不可恢复。`)) return
		try {
			const r = await fetch(
				`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}`,
				{ method: 'DELETE', credentials: 'include' },
			)
			const data = await r.json().catch(() => ({}))
			if (!r.ok || !data.success) throw new Error(data.error || '删除失败')
			showOverlayNotice('success', '会话已删除')
			setTimeout(() => {
				closeOvlModal()
				clearAIChatState()
				window.location.hash = ''
				setMode('chars')
			}, 600)
		} catch (err) {
			showOverlayNotice('error', '删除失败: ' + err.message)
		}
	})
}

// ============================================================
// 群组设置弹窗
// ============================================================
/**
 * 打开群组设置浮层：加载状态、渲染元数据与入群策略表单。
 * @param {string} groupId - 群组 ID
 * @returns {Promise<void>} 异步完成后无返回值
 */
async function openGroupSettingsModal(groupId) {
	openOvlModal({
		title: '群组设置',
		subtitle: '加载中...',
		body:
      '<div style="text-align:center;color:var(--hub-text-muted);padding:40px;">加载中...</div>',
		footer: '',
	})
	let state = null
	try {
		state = await getGroupState(groupId)
	} catch (err) {
		openOvlModal({
			title: '群组设置',
			subtitle: '',
			body: `<div class="ovl-error" style="display:block;">加载失败: ${
				escapeHtml(err.message)
			}</div>`,
			footer:
        '<span></span><button class="ovl-btn ovl-btn-cancel" id="gs-close">关闭</button>',
		})
		document.getElementById('gs-close').addEventListener(
			'click',
			closeOvlModal,
		)
		return
	}

	const isAdmin = (state.myRoles || []).includes('admin')
	const meta = state.groupMeta || {}
	const settings = state.groupSettings || {}
	const memberCount = state.memberCount ||
    (state.members
      ? Object.values(state.members).filter((m) => m?.status === 'active')
      	.length
      : 0)

	openOvlModal({
		title: '群组设置',
		subtitle: meta.name || '群组',
		body: `
<div class="ovl-section">
<h4>基本信息</h4>
<div class="ovl-field">
<label>群组名称</label>
<input type="text" id="gs-name" class="ovl-input" value="${
	escapeHtml(meta.name || '')
}" ${isAdmin ? '' : 'disabled'} maxlength="50" />
</div>
<div class="ovl-field">
<label>群组描述</label>
<textarea id="gs-desc" class="ovl-textarea" ${
      isAdmin ? '' : 'disabled'
} maxlength="200">${escapeHtml(meta.desc || '')}</textarea>
</div>
</div>
<div class="ovl-section">
<h4>谁可以加入</h4>
<div class="ovl-field">
<label>入群策略</label>
<select id="gs-policy" class="ovl-select" ${isAdmin ? '' : 'disabled'}>
<option value="invite-only" ${
      settings.joinPolicy === 'invite-only' ? 'selected' : ''
}>仅邀请 — 仅受邀者可加入</option>
<option value="pow" ${
      settings.joinPolicy === 'pow' ? 'selected' : ''
}>需要 PoW 验证</option>
</select>
</div>
${
	`
<div class="ovl-field" id="gs-pow-wrap" style="${
		settings.joinPolicy === 'pow' ? '' : 'display:none;'
}">
<label>PoW 难度（1-10）</label>
<input type="number" id="gs-pow" class="ovl-input" value="${
	settings.powDifficulty || 4
}" min="1" max="10" ${isAdmin ? '' : 'disabled'} />
</div>`
}
</div>
<div class="ovl-section">
<h4>群组信息</h4>
<div class="ovl-info-row"><span>成员数</span><span>${memberCount}</span></div>
<div class="ovl-info-row"><span>群组 ID</span><span>${
	escapeHtml(groupId)
}</span></div>
<div class="ovl-info-row"><span>你的角色</span><span>${
	(state.myRoles || ['@everyone']).join(' / ')
}</span></div>
</div>
${
      !isAdmin
        ? '<div style="font-size:12px;color:#949ba4;text-align:center;padding:8px;">你不是管理员，无法修改群组设置</div>'
        : `
<div class="ovl-section">
<h4>高级管理</h4>
<div class="ovl-toggle-row" id="gs-advanced" style="cursor:pointer;">
<div>
<div class="ovl-tr-title">权限与角色管理</div>
<div class="ovl-tr-desc">在新标签页打开角色 / 频道权限编辑器</div>
</div>
<span style="color:#5865f2;">↗</span>
</div>
</div>
`
}
`,
		footer: isAdmin
      ? `
<button class="ovl-btn ovl-btn-danger" id="gs-delete">删除群组</button>
<div style="display:flex;gap:8px;">
<button class="ovl-btn ovl-btn-cancel" id="gs-cancel">取消</button>
<button class="ovl-btn ovl-btn-primary" id="gs-save">保存修改</button>
</div>
`
      : `
<span></span>
<button class="ovl-btn ovl-btn-cancel" id="gs-close">关闭</button>
`,
	})
	document.getElementById('gs-cancel')?.addEventListener(
		'click',
		closeOvlModal,
	)
	document.getElementById('gs-close')?.addEventListener('click', closeOvlModal)
	document.getElementById('gs-policy')?.addEventListener('change', (e) => {
		const wrap = document.getElementById('gs-pow-wrap')
		if (wrap) wrap.style.display = e.target.value === 'pow' ? '' : 'none'
	})
	document.getElementById('gs-advanced')?.addEventListener('click', () => {
		window.open(
			`/parts/shells:chat/hub/#group:${encodeURIComponent(groupId)}:default`,
			'_blank',
			'noopener',
		)
	})
	document.getElementById('gs-save')?.addEventListener('click', async () => {
		const name = document.getElementById('gs-name').value.trim()
		const desc = document.getElementById('gs-desc').value.trim()
		const joinPolicy = document.getElementById('gs-policy').value
		const powDifficulty =
      Number.parseInt(document.getElementById('gs-pow')?.value, 10) || 4
		if (!name) {
			showOverlayNotice('error', '请填写群组名称')
			return
		}
		try {
			const r1 = await fetch(`/api/parts/shells:chat/groups/${groupId}/meta`, {
				method: 'PUT',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, desc }),
			})
			if (!r1.ok) throw new Error('保存基本信息失败')
			const r2 = await fetch(
				`/api/parts/shells:chat/groups/${groupId}/settings`,
				{
					method: 'PUT',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ joinPolicy, powDifficulty }),
				},
			)
			if (!r2.ok) throw new Error('保存策略失败')
			showOverlayNotice('success', '群组设置已保存')
			setTimeout(async () => {
				closeOvlModal()
				await loadGroups()
				if (currentGroupId === groupId) 
					document.getElementById('group-name-display').textContent = name
        
			}, 600)
		} catch (err) {
			showOverlayNotice('error', '保存失败: ' + err.message)
		}
	})
	document.getElementById('gs-delete')?.addEventListener('click', async () => {
		if (!confirm(`确认删除群组 ${meta.name}？此操作不可恢复。`)) return
		try {
			const r = await fetch(`/api/parts/shells:chat/groups/${groupId}`, {
				method: 'DELETE',
				credentials: 'include',
			})
			const data = await r.json()
			if (!r.ok || !data.success) throw new Error(data.error || '删除失败')
			showOverlayNotice('success', '群组已删除')
			setTimeout(async () => {
				closeOvlModal()
				currentGroupId = null
				await loadGroups()
				setMode('chars')
				window.location.hash = ''
			}, 600)
		} catch (err) {
			showOverlayNotice('error', '删除失败: ' + err.message)
		}
	})
}

// ============ 初始化 ============
/**
 *
 */
async function init() {
	initializeWebSocket()
	await loadMe()
	await loadGroups()

	// 处理 URL 查询参数与 hash 路由
	const urlParams = new URLSearchParams(window.location.search)
	const charParam = urlParams.get('char')

	const hashRaw = window.location.hash.slice(1)
	const { groupId, channelId } = parseHash()
	const hasSpecificHash = hashRaw.startsWith('group:')

	if (charParam && !hasSpecificHash) {
		// 切换到 AI 角色模式并直接进入聊天
		await setMode('chars')
		await loadCharsList()
		document.querySelectorAll('#channel-list .hub-channel-item').forEach(
			(el) => {
				el.classList.toggle('active', el.dataset.char === charParam)
			},
		)
		await enterAIChat(charParam)
	} else if (groupId) 
		await selectGroup(groupId, channelId)
	 else 
		await setMode('chars')
	
}

window.addEventListener('hashchange', () => {
	const { groupId, channelId } = parseHash()
	if (groupId && groupId !== currentGroupId)
		selectGroup(groupId, channelId)
	else if (
		channelId && channelId !== currentChannelId &&
    currentState?.channels?.[channelId]
	)
		selectChannel(channelId)
})

init()
