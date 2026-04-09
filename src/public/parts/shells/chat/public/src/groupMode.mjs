import { geti18n } from '../../../../../scripts/i18n.mjs'
import { showToastI18n } from '../../../../../scripts/toast.mjs'

import { startGroupAv } from './groupAV.mjs'

/**
 * @returns {{ groupId: string, channelId: string } | null}
 */
export function parseGroupHash() {
	const h = (location.hash || '').replace(/^#/, '')
	if (!h.startsWith('group:')) return null
	const rest = h.slice('group:'.length)
	const parts = rest.split(':')
	if (parts.length < 2) return null
	return { groupId: parts[0], channelId: parts[1] || 'default' }
}

/**
 * @param {string} s
 */
function escapeHtml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

/**
 * 将 DAG 行中的 `message_edit` / `message_delete` 折叠进主消息气泡展示（仍保留事件顺序外的语义）。
 * @param {object[]} messages
 * @returns {object[]}
 */
function mergeChannelMessagesForDisplay(messages) {
	const edits = new Map()
	const deleted = new Set()
	const lastFeedbackIdx = new Map()
	const n = messages.length
	for (let i = 0; i < n; i++) {
		const m = messages[i]
		const cid = m.content?.chatLogEntryId
		if (!cid) continue
		if (m.type === 'message_edit')
			edits.set(cid, m.content)
		if (m.type === 'message_delete')
			deleted.add(cid)
		if (m.type === 'message_feedback')
			lastFeedbackIdx.set(cid, i)
	}
	const out = []
	for (let i = 0; i < n; i++) {
		const m = messages[i]
		if (m.type === 'message_edit' || m.type === 'message_delete')
			continue
		if (m.type === 'message_feedback') {
			const cid = m.content?.chatLogEntryId
			if (!cid || deleted.has(cid)) continue
			if (lastFeedbackIdx.get(cid) !== i) continue
			out.push(m)
			continue
		}
		if (m.type === 'message') {
			const cid = m.content?.chatLogEntryId
			if (cid && deleted.has(cid))
				continue
			if (cid && edits.has(cid)) {
				const e = edits.get(cid)
				out.push({
					...m,
					content: {
						...m.content,
						text: e.text,
						...(e.fileCount != null ? { fileCount: e.fileCount } : {}),
					},
				})
				continue
			}
		}
		out.push(m)
	}
	return out
}

/**
 * 按时间线重放 pin/unpin，得到当前仍置顶的 targetEventId 列表（最近置顶在前）。
 * @param {object[]} messages 频道原始消息行（未 merge）
 * @returns {string[]}
 */
function orderedActivePinTargets(messages) {
	const active = new Set()
	for (const ev of messages) {
		if (ev.type === 'pin_message' && ev.content?.targetId)
			active.add(String(ev.content.targetId))
		if (ev.type === 'unpin_message' && ev.content?.targetId)
			active.delete(String(ev.content.targetId))
	}
	const recentFirst = []
	for (let i = messages.length - 1; i >= 0; i--) {
		const ev = messages[i]
		if (ev.type === 'pin_message' && ev.content?.targetId) {
			const t = String(ev.content.targetId)
			if (active.has(t) && !recentFirst.includes(t))
				recentFirst.push(t)
		}
	}
	return recentFirst
}

/**
 * 按 `parentChannelId` 将频道展平为深度优先列表（用于侧栏树形缩进）。
 * @param {Record<string, { name?: string, type?: string, parentChannelId?: string }>} channels
 * @returns {{ id: string, meta: object, depth: number }[]}
 */
function flattenChannelTree(channels) {
	if (!channels || typeof channels !== 'object') return []
	const byParent = new Map()
	for (const [id, meta] of Object.entries(channels)) {
		const p = (meta.parentChannelId !== undefined && meta.parentChannelId !== null && meta.parentChannelId !== '')
			? String(meta.parentChannelId)
			: ''
		if (!byParent.has(p)) byParent.set(p, [])
		byParent.get(p).push({ id, meta })
	}
	for (const list of byParent.values())
		list.sort((a, b) => (a.meta.name || a.id).localeCompare(b.meta.name || b.id, 'und'))
	/** @type {{ id: string, meta: object, depth: number }[]} */
	const out = []
	/**
	 * @param {string} pid
	 * @param {number} depth
	 */
	function walk(pid, depth) {
		for (const { id, meta } of byParent.get(pid) || []) {
			out.push({ id, meta, depth })
			walk(id, depth + 1)
		}
	}
	walk('', 0)
	return out
}

/**
 * 置顶条里展示的纯文本预览（不含 HTML）。
 * @param {object | undefined} ev
 * @returns {string}
 */
function plainPreviewFromLine(ev) {
	if (!ev) return ''
	const c = ev.content
	if (typeof c === 'string')
		return c.length > 56 ? `${c.slice(0, 56)}…` : c
	if (c && typeof c === 'object') {
		if (c.text != null && String(c.text).trim())
			return String(c.text).length > 56 ? `${String(c.text).slice(0, 56)}…` : String(c.text)
		const fc = Number(c.fileCount) || 0
		if (fc > 0)
			return geti18n('chat.group.attachmentsHint', { n: fc })
		if (c.choice != null)
			return String(c.choice).slice(0, 48)
	}
	if (ev.type === 'message_feedback') {
		const ft = c?.feedbackType
		const tag = ft === 'up' ? geti18n('chat.group.feedbackUp') : ft === 'down' ? geti18n('chat.group.feedbackDown') : ''
		const note = c?.feedbackContent ? String(c.feedbackContent).slice(0, 36) : ''
		return [tag, note].filter(Boolean).join(' ').slice(0, 56) || ev.type
	}
	return (ev.type || 'msg').slice(0, 24)
}

/**
 * @param {object} line
 */
function formatGroupMessageLine(line) {
	if (line.type === 'vote_cast' || line.type === 'vote' || line.content?.ballotId || line.content?.kind === 'vote') {
		const opts = (line.content?.options || []).map(o => escapeHtml(String(o))).join(' / ')
		const choice = line.content?.choice != null ? escapeHtml(String(line.content.choice)) : ''
		const pv = geti18n('chat.group.msgPrefixVote')
		if (line.type === 'vote_cast')
			return `[${pv}] ${geti18n('chat.group.voteCast')} ${choice}`
		return `[${pv}] ${opts}`
	}
	if (line.type === 'sticker' || line.content?.stickerBase64)
		return `[${geti18n('chat.group.msgPrefixSticker')}]`
	if (line.type === 'pin_message')
		return `[${geti18n('chat.group.pinMessage')}] ${escapeHtml(String(line.content?.targetId || ''))}`
	if (line.type === 'unpin_message')
		return `[${geti18n('chat.group.unpinMessage')}] ${escapeHtml(String(line.content?.targetId || ''))}`
	if (line.type === 'message_feedback') {
		const ft = line.content?.feedbackType
		const note = line.content?.feedbackContent
		const label = ft === 'up'
			? geti18n('chat.group.feedbackUp')
			: ft === 'down'
				? geti18n('chat.group.feedbackDown')
				: ''
		return `[${label}]${note ? ` ${escapeHtml(note)}` : ''}`
	}
	if (line.type === 'message_delete')
		return `[${geti18n('chat.group.messageDeleted')}]`
	if (line.type === 'message_edit') {
		const t = line.content?.text
		if (t != null) return escapeHtml(String(t))
	}
	if (line.type === 'message') {
		const raw = typeof line.content === 'string' ? line.content : line.content?.text
		const fc = Number(line.content?.fileCount) || 0
		const textEmpty = raw == null || !String(raw).trim()
		if (textEmpty && fc > 0)
			return escapeHtml(geti18n('chat.group.attachmentsHint', { n: fc }))
		if (!textEmpty && fc > 0) {
			const hint = geti18n('chat.group.attachmentsHint', { n: fc })
			return `${escapeHtml(String(raw))} ${escapeHtml(hint)}`
		}
	}
	const text = typeof line.content === 'string' ? line.content : line.content?.text || JSON.stringify(line.content || {})
	return escapeHtml(text)
}

let groupWs = null
/** @type {AbortController | null} */
let groupUiAbort = null
let listenersBound = false

/**
 * @returns {Promise<void>}
 */
async function applyGroupHash() {
	const panel = document.getElementById('group-mode-panel')
	const tree = document.getElementById('group-channel-tree')
	const members = document.getElementById('group-members-list')
	const msgBox = document.getElementById('group-messages')
	const input = document.getElementById('group-message-input')
	if (!panel || !tree || !msgBox) return

	groupUiAbort?.abort()
	groupUiAbort = new AbortController()
	const { signal } = groupUiAbort

	const parsed = parseGroupHash()
	if (!parsed) {
		// 若 hash 为普通 chatId 格式（非群组 hash），重定向到群组路由
		// 这样单聊也通过群体系展示，实现统一架构
		const rawHash = (location.hash || '').replace(/^#/, '')
		if (rawHash && !rawHash.startsWith('group:') && /^[\w-]{6,}$/u.test(rawHash)) {
			location.hash = `group:${rawHash}:default`
			return
		}
		panel.classList.add('hidden')
		// 显示原有聊天区域
		const mainChat = document.querySelector('.container.mx-auto.lg\\:p-4')
		mainChat?.classList.remove('hidden')
		if (groupWs) {
			groupWs.close()
			groupWs = null
		}
		return
	}

	// 进入群组模式：隐藏原有聊天区域（群组面板已涵盖聊天功能）
	const mainChat = document.querySelector('.container.mx-auto.lg\\:p-4')
	mainChat?.classList.add('hidden')

	panel.classList.remove('hidden')
	const { groupId, channelId } = parsed

	/** @type {Record<string, object>} */
	let lastChannels = {}
	/** @type {object | null} */
	let lastChannelMeta = null

	const typingIndicatorEl = document.getElementById('group-typing-indicator')
	/** @type {ReturnType<typeof setTimeout> | 0} */
	let typingHideTimer = 0
	let lastTypingPost = 0
	const wsClientId = sessionStorage.getItem('group:wsClientId') || crypto.randomUUID()
	sessionStorage.setItem('group:wsClientId', wsClientId)

	/** @type {HTMLDivElement | null} */
	let volatileStreamEl = null
	/** @type {string | null} */
	let volatileStreamId = null

	/** @type {Awaited<ReturnType<typeof startGroupAv>> | null} */
	let avSession = null
	let mainVideoIsLocal = true

	/** @type {string[]} */
	let mentionCharNames = []
	const mentionBox = document.createElement('div')
	mentionBox.className = 'fixed z-[100] hidden max-h-48 overflow-y-auto rounded-lg border border-base-300 bg-base-100 shadow-lg p-1 flex flex-col gap-0.5 min-w-[10rem]'
	document.body.appendChild(mentionBox)
	signal.addEventListener('abort', () => mentionBox.remove())

	;(async () => {
		try {
			const r = await fetch(`/api/parts/shells:chat/${encodeURIComponent(groupId)}/chars`)
			if (r.ok) {
				const j = await r.json()
				mentionCharNames = Array.isArray(j) ? j : []
			}
		}
		catch { /* ignore */ }
	})()

	function hideMentionPopover() {
		mentionBox.classList.add('hidden')
		mentionBox.replaceChildren()
	}

	function updateMentionPopover() {
		if (!input) return
		const pos = input.selectionStart ?? 0
		const before = input.value.slice(0, pos)
		const m = before.match(/@([\w.-]*)$/u)
		if (!m) {
			hideMentionPopover()
			return
		}
		const q = (m[1] || '').toLowerCase()
		const hits = mentionCharNames.filter(n => n.toLowerCase().includes(q)).slice(0, 10)
		mentionBox.replaceChildren()
		if (!hits.length) {
			const hint = document.createElement('div')
			hint.className = 'text-xs opacity-60 px-2 py-1 max-w-xs'
			hint.textContent = geti18n('chat.group.mentionEmpty')
			mentionBox.appendChild(hint)
		}
		else {
			for (const h of hits) {
				const btn = document.createElement('button')
				btn.type = 'button'
				btn.className = 'btn btn-sm btn-ghost justify-start font-normal'
				btn.textContent = `@${h}`
				btn.addEventListener('click', () => {
					const start = before.lastIndexOf('@')
					const newVal = input.value.slice(0, start) + `@${h} ` + input.value.slice(pos)
					input.value = newVal
					const np = start + h.length + 2
					input.selectionStart = input.selectionEnd = np
					hideMentionPopover()
					input.focus()
				})
				mentionBox.appendChild(btn)
			}
		}
		const rect = input.getBoundingClientRect()
		mentionBox.style.left = `${rect.left}px`
		mentionBox.style.top = `${Math.min(rect.bottom + 4, globalThis.innerHeight - 200)}px`
		mentionBox.classList.remove('hidden')
	}

	function sendTypingBroadcast() {
		const now = Date.now()
		if (now - lastTypingPost < 2200) return
		lastTypingPost = now
		fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/broadcast`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				payload: {
					type: 'group_typing',
					channelId,
					sender: 'local_user',
					clientId: wsClientId,
				},
			}),
		}).catch(() => {})
	}

	const loadState = async () => {
		const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/state`)
		if (!r.ok) {
			showToastI18n('error', 'chat.group.loadError')
			return
		}
		const data = await r.json()
		tree.innerHTML = ''
		lastChannels = data.channels || {}
		lastChannelMeta = lastChannels[channelId] || null
		const flat = flattenChannelTree(lastChannels)
		for (const { id, meta, depth } of flat) {
			const li = document.createElement('li')
			const a = document.createElement('a')
			const icon = meta.type === 'list' ? '📑' : meta.type === 'streaming' ? '📹' : '💬'
			a.textContent = `${icon} ${meta.name || id}`
			a.href = `#group:${groupId}:${id}`
			a.className = channelId === id ? 'active' : ''
			li.style.paddingLeft = `${8 + depth * 12}px`
			li.appendChild(a)
			tree.appendChild(li)
		}
		if (members) {
			members.innerHTML = ''
			const mlist = Array.isArray(data.members) ? data.members : []
			if (!mlist.length) {
				const li = document.createElement('li')
				li.className = 'text-xs opacity-70'
				li.textContent = geti18n('chat.group.membersEmpty')
				members.appendChild(li)
			}
			else {
				for (const m of mlist) {
					const li = document.createElement('li')
					li.className = 'text-xs truncate font-mono'
					const id = m.pubKeyHash || ''
					li.textContent = id.length > 20 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id
					li.title = id
					members.appendChild(li)
				}
			}
		}

		const avPanel = document.getElementById('group-av-panel')
		if (avPanel) {
			const isStream = lastChannels[channelId]?.type === 'streaming'
			if (isStream) {
				avPanel.classList.remove('hidden')
				avPanel.classList.add('flex')
			}
			else {
				avPanel.classList.add('hidden')
				avPanel.classList.remove('flex')
			}
		}
	}

	const pullIncrementalDagEvents = async () => {
		const key = `group:lastSyncedEvent:${groupId}`
		const since = sessionStorage.getItem(key) || ''
		const qs = new URLSearchParams({ limit: '120' })
		if (since) qs.set('since', since)
		const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/events?${qs}`)
		if (!r.ok) return
		const { events, truncated } = await r.json()
		if (Array.isArray(events) && events.length) {
			const last = events[events.length - 1]
			if (last?.id) sessionStorage.setItem(key, last.id)
		}
		if (truncated)
			showToastI18n('warning', 'chat.group.syncTruncated')
	}

	const loadBookmarks = async () => {
		const el = document.getElementById('group-bookmarks-list')
		if (!el) return
		const r = await fetch('/api/parts/shells:chat/bookmarks')
		if (!r.ok) {
			el.innerHTML = `<li class="text-xs opacity-50">—</li>`
			return
		}
		const raw = await r.json()
		const list = Array.isArray(raw) ? raw : []
		el.innerHTML = ''
		for (const e of list) {
			if (!e.groupId || !e.channelId) continue
			const li = document.createElement('li')
			const a = document.createElement('a')
			a.className = 'truncate'
			a.href = e.href || `#group:${e.groupId}:${e.channelId}`
			a.textContent = e.title || `${e.groupId.slice(0, 10)}… / ${e.channelId}`
			li.appendChild(a)
			el.appendChild(li)
		}
		if (!el.children.length)
			el.innerHTML = `<li class="text-xs opacity-50">—</li>`
	}

	const loadMessages = async () => {
		const meta = lastChannelMeta
		const sendBtn = document.getElementById('group-send-button')
		if (meta?.type === 'list') {
			msgBox.innerHTML = ''
			const items = meta.manualItems || []
			if (!items.length)
				msgBox.innerHTML = `<p class="text-sm opacity-60 p-2">${geti18n('chat.group.listEmpty')}</p>`
			else
				for (const it of items) {
					const el = document.createElement('div')
					el.className = 'card card-compact bg-base-100 border border-base-300 p-3 mb-2'
					const title = escapeHtml(it.title || '')
					const desc = it.desc ? `<p class="text-xs mt-1 opacity-80">${escapeHtml(it.desc)}</p>` : ''
					const href = it.targetChannelId
						? `#group:${groupId}:${encodeURIComponent(it.targetChannelId)}`
						: (it.url || '#')
					const target = it.url && !it.targetChannelId ? ' rel="noopener noreferrer" target="_blank"' : ''
					el.innerHTML = `<a class="link link-primary font-medium" href="${href}"${target}>${title}</a>${desc}`
					msgBox.appendChild(el)
				}
			if (input) {
				input.disabled = true
				input.placeholder = geti18n('chat.group.listChannelReadonly')
			}
			if (sendBtn) sendBtn.disabled = true
			return
		}
		if (input) {
			input.disabled = false
			input.placeholder = ''
		}
		if (sendBtn) sendBtn.disabled = false

		const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/messages`)
		if (!r.ok) return
		const { messages } = await r.json()
		const merged = mergeChannelMessagesForDisplay(messages)
		const volHold = volatileStreamEl
		if (volHold?.parentNode) volHold.parentNode.removeChild(volHold)
		msgBox.innerHTML = ''

		const pinOrder = orderedActivePinTargets(messages)
		if (pinOrder.length) {
			const bar = document.createElement('div')
			bar.className = 'sticky top-0 z-10 bg-base-200/95 border border-base-300 rounded-lg px-2 py-2 mb-2 shadow-sm'
			const title = document.createElement('div')
			title.className = 'text-xs font-semibold opacity-80'
			title.textContent = geti18n('chat.group.pinsBarTitle')
			bar.appendChild(title)
			const chips = document.createElement('div')
			chips.className = 'flex flex-wrap gap-1.5 mt-1.5'
			for (const tid of pinOrder) {
				const src = messages.find(x => x.eventId === tid)
				const preview = plainPreviewFromLine(src) || `${tid.slice(0, 8)}…`
				const btn = document.createElement('button')
				btn.type = 'button'
				btn.className = 'btn btn-xs btn-ghost h-auto min-h-0 py-1.5 px-2 text-left max-w-[min(100%,20rem)] normal-case whitespace-normal'
				btn.textContent = preview
				btn.title = tid
				btn.addEventListener('click', () => {
					const el = msgBox.querySelector(`[data-event-anchor="${CSS.escape(tid)}"]`)
					el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
				})
				chips.appendChild(btn)
			}
			bar.appendChild(chips)
			msgBox.appendChild(bar)
		}

		const postPin = async (targetEventId, unpin) => {
			const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/pin`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(unpin ? { targetEventId, unpin: true } : { targetEventId }),
			})
			if (r.ok) {
				await loadMessages()
				showToastI18n('success', unpin ? 'chat.group.unpinOk' : 'chat.group.pinOk')
			}
			else
				showToastI18n('error', 'chat.group.pinFailed')
		}

		for (const m of merged) {
			const div = document.createElement('div')
			div.className = 'chat chat-start py-1 scroll-mt-3'
			if (m.eventId)
				div.setAttribute('data-event-anchor', m.eventId)
			const bubbleClass = m.type === 'message_feedback'
				? 'chat-bubble chat-bubble-secondary text-sm opacity-90'
				: 'chat-bubble'
			const row = document.createElement('div')
			row.className = 'flex items-start gap-2 w-full max-w-full'
			const main = document.createElement('div')
			main.className = 'flex-1 min-w-0'
			const header = document.createElement('div')
			header.className = 'chat-header text-xs opacity-70'
			header.textContent = m.sender || ''
			const bubble = document.createElement('div')
			bubble.className = bubbleClass
			bubble.innerHTML = formatGroupMessageLine(m)
			main.appendChild(header)
			main.appendChild(bubble)
			const lateMs = 30_000
			const ra = Number(m.receivedAt)
			const ts = Number(m.timestamp)
			if (Number.isFinite(ra) && Number.isFinite(ts) && ra - ts > lateMs) {
				const late = document.createElement('div')
				late.className = 'text-[10px] opacity-60 mt-0.5'
				late.textContent = geti18n('chat.group.lateDelivery')
				main.appendChild(late)
			}
			row.appendChild(main)

			const actions = document.createElement('div')
			actions.className = 'flex flex-col gap-1 shrink-0 items-stretch pt-0.5'
			if (m.type === 'pin_message' && m.content?.targetId) {
				const unpinBtn = document.createElement('button')
				unpinBtn.type = 'button'
				unpinBtn.className = 'btn btn-outline btn-xs whitespace-nowrap min-h-8'
				unpinBtn.textContent = geti18n('chat.group.unpinAction')
				unpinBtn.title = geti18n('chat.group.unpinAction')
				unpinBtn.addEventListener('click', () => postPin(String(m.content.targetId), true))
				actions.appendChild(unpinBtn)
			}
			else if (m.type !== 'unpin_message' && m.eventId) {
				const pinBtn = document.createElement('button')
				pinBtn.type = 'button'
				pinBtn.className = 'btn btn-outline btn-xs whitespace-nowrap min-h-8'
				pinBtn.textContent = geti18n('chat.group.pinAction')
				pinBtn.title = geti18n('chat.group.pinThisMessage')
				pinBtn.addEventListener('click', () => postPin(m.eventId, false))
				actions.appendChild(pinBtn)
			}
			if (actions.childElementCount)
				row.appendChild(actions)

			div.appendChild(row)
			msgBox.appendChild(div)
		}
		if (volHold && volatileStreamId) msgBox.appendChild(volHold)
		msgBox.scrollTop = msgBox.scrollHeight
	}

	await pullIncrementalDagEvents()
	await loadState()
	await loadBookmarks()
	await loadMessages()

	const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
	const wsUrl = `${wsProto}//${window.location.host}/ws/parts/shells:chat/group/${encodeURIComponent(groupId)}`
	if (groupWs)
		groupWs.close()
	groupWs = new WebSocket(wsUrl)
	groupWs.onmessage = ev => {
		try {
			const msg = JSON.parse(ev.data)
			if (msg.type === 'group_typing' && msg.channelId === channelId) {
				if (msg.clientId === wsClientId) return
				if (typingIndicatorEl) {
					typingIndicatorEl.textContent = geti18n('chat.group.remoteTyping', { name: msg.sender || '?' })
					typingIndicatorEl.classList.remove('hidden')
					clearTimeout(typingHideTimer)
					typingHideTimer = setTimeout(() => typingIndicatorEl.classList.add('hidden'), 3200)
				}
			}
			if (msg.type === 'channel_message' && msg.channelId === channelId)
				loadMessages()
			if (msg.type === 'dag_event') {
				if (msg.event?.id)
					sessionStorage.setItem(`group:lastSyncedEvent:${groupId}`, msg.event.id)
				loadState()
				loadBookmarks()
			}
			if (msg.type === 'group_stream_start' && msg.channelId === channelId) {
				volatileStreamEl?.remove()
				volatileStreamId = msg.pendingStreamId || null
				volatileStreamEl = document.createElement('div')
				volatileStreamEl.className = 'chat chat-start py-1 scroll-mt-3 border border-dashed border-primary/40 rounded-lg px-2 py-2 bg-base-200/40'
				const head = document.createElement('div')
				head.className = 'chat-header text-xs opacity-70'
				head.textContent = msg.charId ? `@${msg.charId}` : geti18n('chat.group.aiStreaming')
				const body = document.createElement('div')
				body.className = 'whitespace-pre-wrap break-words text-sm'
				body.dataset.volatileBody = '1'
				volatileStreamEl.appendChild(head)
				volatileStreamEl.appendChild(body)
				msgBox.appendChild(volatileStreamEl)
				msgBox.scrollTop = msgBox.scrollHeight
			}
			if (msg.type === 'group_stream_chunk' && msg.channelId === channelId && msg.pendingStreamId === volatileStreamId) {
				const body = volatileStreamEl?.querySelector('[data-volatile-body]')
				if (body && typeof msg.text === 'string') {
					body.textContent += msg.text
					msgBox.scrollTop = msgBox.scrollHeight
				}
			}
			if (msg.type === 'group_stream_end' && msg.channelId === channelId) {
				volatileStreamEl?.remove()
				volatileStreamEl = null
				volatileStreamId = null
				loadMessages()
			}
		if (msg.type === 'webrtc_signal' && msg.channelId === channelId && avSession)
			avSession.handleSignal(msg)
		}
		catch { /* ignore */ }
	}

	const avBroadcast = async payload => {
		await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/broadcast`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ payload }),
		})
	}

	/** 启动或停止 AV 会话（供 av-start 和 streaming-button 共用） */
	const startAvSession = async () => {
		if (lastChannelMeta?.type !== 'streaming') {
			showToastI18n('info', 'chat.group.avNeedStreamChannel')
			return
		}
		if (avSession) return
		try {
			const videoLocal = document.getElementById('group-av-local')
			// 多方远端视频挂载容器：group-av-remote 作为容器使用
			const remoteContainer = document.getElementById('group-av-remote')
			avSession = await startGroupAv({
				channelId,
				clientId: wsClientId,
				videoLocal,
				remoteContainer,
				broadcast: avBroadcast,
			})
		}
		catch {
			showToastI18n('error', 'chat.voiceRecording.errorAccessingMicrophone')
		}
	}

	document.getElementById('group-av-start')?.addEventListener('click', startAvSession, { signal })

	document.getElementById('group-av-mute')?.addEventListener('click', () => {
		avSession?.toggleMute()
	}, { signal })

	document.getElementById('group-av-swap')?.addEventListener('click', () => {
		const a = document.getElementById('group-av-local')
		if (!a) return
		mainVideoIsLocal = !mainVideoIsLocal
		a.classList.toggle('ring-2', mainVideoIsLocal)
		a.classList.toggle('ring-primary', mainVideoIsLocal)
	}, { signal })

	document.getElementById('group-av-stop')?.addEventListener('click', () => {
		avSession?.close()
		avSession = null
	}, { signal })

	const postMessage = async () => {
		const text = input?.value?.trim()
		if (!text) return
		const r = await fetch(`/api/parts/shells:chat/${encodeURIComponent(groupId)}/message`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				reply: {
					content: text,
					groupChannelId: channelId,
				},
			}),
		})
		if (r.ok && input) {
			input.value = ''
			await loadMessages()
		}
		else if (r.status === 404)
			showToastI18n('error', 'chat.group.chatNotLoaded')
		else
			showToastI18n('error', 'chat.group.sendFailed')
	}

	document.getElementById('group-send-button')?.addEventListener('click', postMessage, { signal })
	input?.addEventListener('keydown', e => {
		if (e.key === 'Escape')
			hideMentionPopover()
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault()
			postMessage()
		}
	}, { signal })
	input?.addEventListener('input', () => {
		updateMentionPopover()
		sendTypingBroadcast()
	}, { signal })
	input?.addEventListener('blur', () => {
		globalThis.setTimeout(() => hideMentionPopover(), 180)
	}, { signal })

	document.getElementById('group-streaming-button')?.addEventListener('click', () => {
		// 导航到 streaming 类型频道，或启动已在 streaming 频道中的 AV 会话
		if (lastChannelMeta?.type === 'streaming')
			startAvSession().catch(() => {})
		else
			document.getElementById('group-av-panel')?.classList.remove('hidden')
	}, { signal })

	document.getElementById('group-bookmark-add')?.addEventListener('click', async () => {
		const r0 = await fetch('/api/parts/shells:chat/bookmarks')
		if (!r0.ok) return showToastI18n('error', 'chat.group.bookmarkSaveFailed')
		const raw = await r0.json()
		const arr = Array.isArray(raw) ? [...raw] : []
		if (arr.some(e => e.groupId === groupId && e.channelId === channelId)) {
			showToastI18n('info', 'chat.group.bookmarkExists')
			return
		}
		arr.push({
			groupId,
			channelId,
			title: `${lastChannels[channelId]?.name || channelId}`,
			href: `#group:${groupId}:${channelId}`,
		})
		const r = await fetch('/api/parts/shells:chat/bookmarks', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ entries: arr }),
		})
		if (r.ok) {
			showToastI18n('success', 'chat.group.bookmarkAdded')
			await loadBookmarks()
		}
		else
			showToastI18n('error', 'chat.group.bookmarkSaveFailed')
	}, { signal })
}

/**
 * @returns {Promise<void>}
 */
export async function initGroupModeFromHash() {
	if (!listenersBound) {
		listenersBound = true
		window.addEventListener('hashchange', () => {
			applyGroupHash()
		})
		document.getElementById('group-create-button')?.addEventListener('click', async () => {
			const r = await fetch('/api/parts/shells:chat/groups', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: geti18n('chat.group.newGroupName') }),
			})
			if (!r.ok) return showToastI18n('error', 'chat.group.createFailed')
			const { groupId: gid } = await r.json()
			location.hash = `group:${gid}:default`
		})

		document.getElementById('group-new-channel-button')?.addEventListener('click', async () => {
			const p = parseGroupHash()
			if (!p) return
			const name = globalThis.prompt(geti18n('chat.group.newChannelPrompt'), '')
			if (!name?.trim()) return
			const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(p.groupId)}/channels`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: name.trim(), type: 'text' }),
			})
			if (!r.ok) return showToastI18n('error', 'chat.group.newChannelFailed')
			const j = await r.json()
			if (j.channelId)
				location.hash = `group:${p.groupId}:${j.channelId}`
		})
	}
	await applyGroupHash()
}
