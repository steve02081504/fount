/**
 * GH Pages 联邦群聊客户端
 *
 * 功能：
 *  - Ed25519 身份（IndexedDB 持久化，跨会话复用）
 *  - Checkpoint 拉取与本地 IndexedDB 缓存
 *  - 消息历史展示（懒加载）
 *  - stream_chunk + 序号检测 + NACK + stream_end
 *  - 存储用量展示
 */

import { geti18n, geti18n_nowarn, initTranslations, onLanguageChange, setLocalizeLogic } from '../scripts/i18n.mjs'

const PREFIX = 'chat.group.ghpages'
const STORAGE_KEY = 'fount-ghpages-group'
const DB_NAME = 'fount-ghpages'
const DB_VERSION = 2

// ─── DOM refs ───────────────────────────────────────────────────────────────

const originInput = /** @type {HTMLInputElement} */ document.getElementById('origin')
const gidInput = /** @type {HTMLInputElement} */ document.getElementById('gid')
const cidInput = /** @type {HTMLInputElement} */ document.getElementById('cid')
const apiKeyInput = /** @type {HTMLInputElement} */ document.getElementById('apikey')
const msgInput = /** @type {HTMLTextAreaElement} */ document.getElementById('msg')
const connectBtn = document.getElementById('connect')
const disconnectBtn = document.getElementById('disconnect')
const logEl = document.getElementById('log')
const messagesEl = document.getElementById('messages-inner')
const streamIndicator = document.getElementById('stream-indicator')
const connStatus = document.getElementById('conn-status')
const cpStatus = document.getElementById('checkpoint-status')
const storageStatus = document.getElementById('storage-status')
const pubkeyDisplay = document.getElementById('pubkey-display')

/** @type {string | number | null} */
let lastCpEpoch = null
/** @type {string} */
let connStatusSuffix = 'groupDisconnected'

/**
 * 根据当前 `connStatusSuffix` 刷新连接状态文案。
 * @returns {void}
 */
function renderConnStatus() {
	if (!connStatus) return
	connStatus.textContent = geti18n(`${PREFIX}.${connStatusSuffix}`)
}

/**
 * 切换连接状态对应的 i18n 短键并刷新展示。
 * @param {string} suffix `PREFIX` 下的键后缀（如 `ghpagesConnecting`）
 * @returns {void}
 */
function setConnStatusSuffix(suffix) {
	connStatusSuffix = suffix
	renderConnStatus()
}

/**
 * 刷新 Checkpoint 一行（支持语言切换后重查模板键）。
 * @returns {void}
 */
function refreshCpStatus() {
	if (!cpStatus) return
	if (lastCpEpoch == null) {
		cpStatus.textContent = ''
		return
	}
	const line = geti18n_nowarn(`${PREFIX}.statusCheckpointEpoch`, { epoch: lastCpEpoch })
	cpStatus.textContent = line ?? `Checkpoint epoch:${lastCpEpoch}`
}

/**
 * 流式占位行中 AI 发送者前缀（可配翻译键，缺省为 [AI]）。
 * @returns {string} 前缀展示文案
 */
function streamAiPrefix() {
	return geti18n_nowarn(`${PREFIX}.streamAiPrefix`) || '[AI]'
}

/**
 * 根据缓冲内容重绘流式占位元素文本。
 * @param {{ chunks: Map<number, string>, done: boolean, el: HTMLElement | null }} buf 流缓冲
 * @returns {void}
 */
function renderStreamBufText(buf) {
	if (!buf.el) return
	let i = 0
	const parts = []
	while (buf.chunks.has(i)) parts.push(buf.chunks.get(i++))
	const content = parts.join('')
	const maxSeq = buf.chunks.size ? Math.max(...buf.chunks.keys()) : 0
	const gap = i <= maxSeq ? ' …' : ''
	buf.el.textContent = `${streamAiPrefix()} ${content}${gap}`
}

// ─── IndexedDB helpers ───────────────────────────────────────────────────────

/**
 * 打开或升级 GH Pages 群聊使用的 IndexedDB。
 * @returns {Promise<IDBDatabase>} 已打开的数据库实例
 */
function openDb() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		/**
		 * 在版本升级时创建所需的对象仓库。
		 * @returns {void} 无返回值
		 */
		req.onupgradeneeded = () => {
			const db = req.result
			if (!db.objectStoreNames.contains('identity'))
				db.createObjectStore('identity', { keyPath: 'id' })
			if (!db.objectStoreNames.contains('messages'))
				db.createObjectStore('messages', { keyPath: 'key' }) // key = `${groupId}:${channelId}:${eventId}`
			if (!db.objectStoreNames.contains('checkpoints'))
				db.createObjectStore('checkpoints', { keyPath: 'groupId' })
		}
		/**
		 * 打开成功后解析数据库实例。
		 * @returns {void} 无返回值
		 */
		req.onsuccess = () => resolve(req.result)
		/**
		 * 打开失败时拒绝 Promise。
		 * @returns {void} 无返回值
		 */
		req.onerror = () => reject(req.error)
	})
}

/**
 * 从指定对象仓库按键读取单条记录。
 * @param {IDBDatabase} db 数据库实例
 * @param {string} store 对象仓库名称
 * @param {string} key 主键
 * @returns {Promise<any>} 查询结果，不存在时为 undefined
 */
function dbGet(db, store, key) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readonly')
		const r = tx.objectStore(store).get(key)
		/**
		 * 读取成功后解析记录值。
		 * @returns {void} 无返回值
		 */
		r.onsuccess = () => resolve(r.result)
		/**
		 * 读取失败时拒绝 Promise。
		 * @returns {void} 无返回值
		 */
		r.onerror = () => reject(r.error)
	})
}

/**
 * 向指定对象仓库写入或覆盖一条记录。
 * @param {IDBDatabase} db 数据库实例
 * @param {string} store 对象仓库名称
 * @param {object} value 含主键字段的记录对象
 * @returns {Promise<void>} 写入完成时解析
 */
function dbPut(db, store, value) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readwrite')
		const r = tx.objectStore(store).put(value)
		/**
		 * 写入成功后结束 Promise。
		 * @returns {void} 无返回值
		 */
		r.onsuccess = () => resolve()
		/**
		 * 写入失败时拒绝 Promise。
		 * @returns {void} 无返回值
		 */
		r.onerror = () => reject(r.error)
	})
}

/**
 * 读取指定对象仓库中的全部记录。
 * @param {IDBDatabase} db 数据库实例
 * @param {string} store 对象仓库名称
 * @returns {Promise<any[]>} 记录数组，空仓库时为 []
 */
function dbGetAll(db, store) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readonly')
		const r = tx.objectStore(store).getAll()
		/**
		 * 读取成功后解析全部记录。
		 * @returns {void} 无返回值
		 */
		r.onsuccess = () => resolve(r.result || [])
		/**
		 * 读取失败时拒绝 Promise。
		 * @returns {void} 无返回值
		 */
		r.onerror = () => reject(r.error)
	})
}

// ─── Ed25519 identity ────────────────────────────────────────────────────────

/**
 * 从 IndexedDB 读取或生成并持久化 Ed25519 身份。
 * @param {IDBDatabase} db 数据库实例
 * @returns {Promise<{ id: string, privKeyHex: string, pubKeyHex: string, pubKeyHash: string, displayName: string }>} 身份记录
 */
async function getOrCreateIdentity(db) {
	let identity = await dbGet(db, 'identity', 'self')
	if (!identity) {
		const { ed25519 } = await import('https://esm.sh/@noble/ed25519@2')
		const privKey = ed25519.utils.randomPrivateKey()
		const pubKey = await ed25519.getPublicKeyAsync(privKey)
		const hashBuf = await crypto.subtle.digest('SHA-256', pubKey)
		const hashArr = new Uint8Array(hashBuf)
		/**
		 * 将字节数组转为小写十六进制字符串。
		 * @param {Uint8Array} u8 字节数组
		 * @returns {string} 十六进制字符串
		 */
		const toHex = u8 => Array.from(u8, b => b.toString(16).padStart(2, '0')).join('')
		identity = {
			id: 'self',
			privKeyHex: toHex(privKey),
			pubKeyHex: toHex(pubKey),
			pubKeyHash: toHex(hashArr),
			displayName: `user-${toHex(hashArr).slice(0, 6)}`,
		}
		await dbPut(db, 'identity', identity)
	}
	return identity
}

// ─── Volatile stream buffer ──────────────────────────────────────────────────

/** @type {Map<string, { chunks: Map<number,string>, done: boolean, el: HTMLElement | null }>} */
const streamBufs = new Map()

/**
 * 获取或创建指定流 ID 的本地缓冲结构。
 * @param {string} sid 流会话 ID
 * @returns {{ chunks: Map<number, string>, done: boolean, el: HTMLElement | null }} 缓冲对象
 */
function getStreamBuf(sid) {
	if (!streamBufs.has(sid))
		streamBufs.set(sid, { chunks: new Map(), done: false, el: null })
	return streamBufs.get(sid)
}

/**
 * 追加流式分片、检测缺口并更新占位 UI。
 * @param {string} sid 流会话 ID
 * @param {number} seq 分片序号
 * @param {string} text 分片文本
 * @returns {void} 无返回值
 */
function addStreamChunk(sid, seq, text) {
	const buf = getStreamBuf(sid)
	buf.chunks.set(seq, text)
	// 找连续前缀
	let i = 0
	while (buf.chunks.has(i)) i++
	// VOLATILE 无联邦 NACK（§6.4）；缺口不触发补传协议
	// 更新 UI
	if (!buf.el) {
		buf.el = document.createElement('div')
		buf.el.className = 'text-sm italic opacity-70 bg-base-200 rounded px-2 py-1'
		messagesEl?.appendChild(buf.el)
	}
	renderStreamBufText(buf)
	messagesEl?.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' })
	streamIndicator?.classList.remove('hidden')
}

/**
 * 结束指定流并恢复消息样式。
 * @param {string} sid 流会话 ID
 * @returns {void} 无返回值
 */
function endStream(sid) {
	const buf = streamBufs.get(sid)
	if (buf) {
		buf.done = true
		buf.el?.classList.remove('italic', 'opacity-70')
	}
	streamIndicator?.classList.add('hidden')
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

/**
 * 向日志面板追加一行文本。
 * @param {string} line 日志文本
 * @returns {void} 无返回值
 */
function log(line) {
	if (!logEl) return
	logEl.textContent += `${line}\n`
	logEl.scrollTop = logEl.scrollHeight
}

/**
 * 在消息列表中追加一条聊天或事件消息。
 * @param {object} msg 消息对象（结构随服务端事件变化）
 * @returns {void} 无返回值
 */
function addMessage(msg) {
	if (!messagesEl) return
	const p = msg.content?.placeholder
	if (p) {
		const empty = messagesEl.querySelector('[data-i18n]')
		empty?.remove()
	}
	const empty = messagesEl.querySelector('[data-i18n]')
	empty?.remove()

	const el = document.createElement('div')
	el.className = 'flex flex-col gap-0.5'
	const sender = msg.sender ? `${msg.sender.slice(0, 8)}…` : '?'
	const role = msg.content?.role || msg.type
	const text = msg.content?.text || msg.content?.message || JSON.stringify(msg.content || msg).slice(0, 200)
	el.innerHTML = `
		<div class="flex gap-1 items-baseline text-xs opacity-50">
			<span class="font-mono">${sender}</span>
			<span>${role}</span>
		</div>
		<div class="bg-base-200 rounded px-2 py-1 text-sm whitespace-pre-wrap">${text}</div>
	`
	messagesEl.appendChild(el)
	messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' })
}

/**
 * 读取 StorageManager 估算值并更新用量展示。
 * @returns {Promise<void>} 无有意义返回值
 */
async function updateStorageStatus() {
	try {
		if (!navigator.storage?.estimate) return
		const { usage = 0, quota = 0 } = await navigator.storage.estimate()
		/**
		 * 将字节数格式化为 KB/MB 展示字符串。
		 * @param {number} n 字节数
		 * @returns {string} 人类可读的大小字符串
		 */
		const fmt = n => n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`
		if (storageStatus)
			storageStatus.textContent = `IndexedDB: ${fmt(usage)} / ${fmt(quota)}`
	}
	catch { /* ignore */ }
}

// ─── Prefs ───────────────────────────────────────────────────────────────────

/**
 * 从 localStorage 恢复表单偏好（源站、群 ID 等）。
 * @returns {void} 无返回值
 */
function loadPrefs() {
	try {
		const j = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
		if (j.origin) originInput.value = j.origin
		if (j.gid) gidInput.value = j.gid
		if (j.cid) cidInput.value = j.cid
		if (j.apiKey) apiKeyInput.value = j.apiKey
	}
	catch { /* ignore */ }
}

/**
 * 将当前表单值写入 localStorage。
 * @returns {void} 无返回值
 */
function savePrefs() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({
			origin: originInput.value,
			gid: gidInput.value,
			cid: cidInput.value,
			apiKey: apiKeyInput.value,
		}))
	}
	catch { /* ignore */ }
}

/**
 * 若填写了 API Key，则构造 Authorization 请求头。
 * @returns {Record<string, string>} 请求头对象，无令牌时为空对象
 */
function authHeaders() {
	const tok = apiKeyInput?.value?.trim()
	return tok ? { Authorization: `Bearer ${tok}` } : {}
}

/**
 * 合并默认 CORS/凭据策略与鉴权头，供 fetch 使用。
 * @param {RequestInit} [init] 额外的 fetch 初始化参数
 * @returns {RequestInit} 合并后的初始化对象
 */
function fetchOpts(init = {}) {
	const token = apiKeyInput?.value?.trim()
	const { headers: h0 = {}, ...rest } = init
	return { mode: 'cors', credentials: token ? 'omit' : 'include', ...rest, headers: { ...h0, ...authHeaders() } }
}

// ─── Core session state ──────────────────────────────────────────────────────

let ws = null
let lastEventId = null

/**
 * 从 REST 拉取群 Checkpoint 并写入 IndexedDB。
 * @param {IDBDatabase} db 数据库实例
 * @param {string} groupId 群组 ID
 * @param {string} origin 站点根 URL（无末尾斜杠）
 * @returns {Promise<object | null>} Checkpoint 对象；失败时为 null
 */
async function loadCheckpoint(db, groupId, origin) {
	const base = `${origin}/api/parts/shells:chat`
	try {
		const r = await fetch(`${base}/groups/${encodeURIComponent(groupId)}/snapshot`, fetchOpts())
		if (!r.ok) {
			log(geti18n(`${PREFIX}.groupCpFail`, { status: r.status }))
			return null
		}
		const body = await r.json()
		const cp = body?.snapshot ?? null
		if (!cp || typeof cp !== 'object') {
			log(geti18n(`${PREFIX}.groupCpFail`, { status: 'no snapshot' }))
			return null
		}
		await dbPut(db, 'checkpoints', { groupId, snapshot: cp })
		lastCpEpoch = cp.epoch_id ?? '?'
		refreshCpStatus()
		log(geti18n(`${PREFIX}.groupCpOk`, { epoch: cp.epoch_id ?? '?', pins: '{}' }))
		return cp
	}
	catch (e) {
		log(geti18n(`${PREFIX}.groupRestFail`, { msg: e?.message || e }))
		return null
	}
}

/**
 * 分页拉取频道历史消息并重绘列表、写入缓存。
 * @param {IDBDatabase} db 数据库实例
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {string} origin 站点根 URL（无末尾斜杠）
 * @returns {Promise<void>} 无有意义返回值
 */
async function loadMessages(db, groupId, channelId, origin) {
	const base = `${origin}/api/parts/shells:chat`
	try {
		const url = `${base}/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/messages?limit=50${lastEventId ? `&before=${encodeURIComponent(lastEventId)}` : ''}`
		const r = await fetch(url, fetchOpts())
		if (!r.ok) {
			log(geti18n(`${PREFIX}.groupMsgFail`, { status: r.status }))
			return
		}
		const { messages = [] } = await r.json()
		if (messagesEl) messagesEl.innerHTML = ''
		for (const msg of messages) {
			addMessage(msg)
			// 缓存到 IndexedDB
			await dbPut(db, 'messages', { key: `${groupId}:${channelId}:${msg.id || msg.chatLogEntryId}`, ...msg })
		}
		if (messages.length)
			lastEventId = messages[0]?.id || messages[0]?.chatLogEntryId || null
		log(geti18n(`${PREFIX}.groupMsgOk`, { n: messages.length }))
		await updateStorageStatus()
	}
	catch (e) {
		log(geti18n(`${PREFIX}.groupRestFail`, { msg: e?.message || e }))
	}
}

/**
 * 建立 REST 预拉取与群 WebSocket 会话。
 * @param {IDBDatabase} db 数据库实例
 * @param {Awaited<ReturnType<typeof getOrCreateIdentity>>} identity 当前用户身份
 * @returns {Promise<void>} 无有意义返回值
 */
async function connect(db, identity) {
	const origin = (originInput?.value || '').replace(/\/$/, '')
	const groupId = gidInput?.value?.trim()
	const channelId = cidInput?.value?.trim() || 'default'
	if (!origin || !groupId) {
		log(geti18n(`${PREFIX}.groupFillOrigin`))
		return
	}
	savePrefs()

	if (ws) {
		ws.close()
		ws = null
	}

	lastCpEpoch = null
	refreshCpStatus()
	setConnStatusSuffix('ghpagesConnecting')
	const base = `${origin}/api/parts/shells:chat`

	// 先拉 Checkpoint
	const cp = await loadCheckpoint(db, groupId, origin)

	// 拉初始消息（从 IndexedDB 回放缓存或从服务端）
	const cached = await dbGetAll(db, 'messages')
	const prefix = `${groupId}:${channelId}:`
	const cachedMsgs = cached.filter(m => m.key.startsWith(prefix))
	if (cachedMsgs.length) {
		if (messagesEl) messagesEl.innerHTML = ''
		for (const m of cachedMsgs) addMessage(m)
		log(`[cache] ${cachedMsgs.length} messages`)
	}
	await loadMessages(db, groupId, channelId, origin)

	// 建立 WebSocket
	const u = new URL(origin)
	const proto = u.protocol === 'https:' ? 'wss:' : 'ws:'
	const wsUrl = `${proto}//${u.host}/ws/parts/shells:chat/groups/${encodeURIComponent(groupId)}`
	const token = apiKeyInput?.value?.trim()
	log(geti18n(`${PREFIX}.groupWsConnecting`, { url: wsUrl }))

	ws = token ? new WebSocket(wsUrl, [token]) : new WebSocket(wsUrl)

	/**
	 * WebSocket 打开后更新 UI 状态。
	 * @returns {void} 无返回值
	 */
	ws.onopen = () => {
		setConnStatusSuffix('ghpagesConnected')
		log(geti18n(`${PREFIX}.groupWsOpen`))
		connectBtn?.classList.add('hidden')
		disconnectBtn?.classList.remove('hidden')
	}

	/**
	 * WebSocket 关闭后恢复按钮与状态文案。
	 * @returns {void} 无返回值
	 */
	ws.onclose = () => {
		setConnStatusSuffix('ghpagesDisconnected')
		log(geti18n(`${PREFIX}.groupWsClose`))
		connectBtn?.classList.remove('hidden')
		disconnectBtn?.classList.add('hidden')
	}

	/**
	 * WebSocket 出错时记录日志。
	 * @returns {void} 无返回值
	 */
	ws.onerror = () => log(geti18n(`${PREFIX}.groupWsError`))

	/**
	 * 处理服务端推送的频道消息与流事件。
	 * @param {MessageEvent<string>} ev 原始消息事件
	 * @returns {Promise<void>} 无有意义返回值
	 */
	ws.onmessage = async ev => {
		try {
			const msg = JSON.parse(ev.data)

			if (msg.type === 'channel_message' && msg.channelId === channelId) {
				addMessage(msg.message || msg)
				if (msg.message?.id)
					await dbPut(db, 'messages', { key: `${groupId}:${channelId}:${msg.message.id}`, ...msg.message })
				await updateStorageStatus()
			}
			else if (msg.type === 'group_stream_chunk' || msg.type === 'stream_chunk') {
				const sid = msg.pendingStreamId || msg.pending_stream_id
				const seq = Number(msg.chunkSeq ?? msg.chunk_seq ?? 0)
				const text = msg.content?.text || msg.text || ''
				if (sid) addStreamChunk(sid, seq, text)
			}
			else if (msg.type === 'group_stream_end' || msg.type === 'stream_end') {
				const sid = msg.pendingStreamId || msg.pending_stream_id
				if (sid) endStream(sid)
			}
			else if (msg.type === 'dag_event')
				log(geti18n(`${PREFIX}.groupLogDag`, { id: msg.event?.id || '?' }))

			else
				log(geti18n(`${PREFIX}.groupLogEvent`, { type: msg.type || '?' }))

		}
		catch { log(ev.data.slice(0, 120)) }
	}

	// 拉 Checkpoint 中的状态摘要
	if (cp) {
		const chCount = Object.keys(cp.channels || {}).length
		log(geti18n(`${PREFIX}.groupStateOk`, { n: chCount }))
	}
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * 页面入口：初始化 i18n、身份、事件绑定并可自动连接。
 * @returns {Promise<void>} 无有意义返回值
 */
async function main() {
	await initTranslations('chat.group.ghpages')

	const localizeBindings = [
		[connStatus, renderConnStatus],
		[cpStatus, refreshCpStatus],
		[storageStatus, updateStorageStatus],
	]
	for (const [el, render] of localizeBindings)
		if (el) setLocalizeLogic(el, render)

	onLanguageChange(() => {
		for (const [, buf] of streamBufs)
			if (buf.el) renderStreamBufText(buf)
	})

	const db = await openDb()
	const identity = await getOrCreateIdentity(db)

	if (pubkeyDisplay)
		pubkeyDisplay.textContent = identity.pubKeyHash.slice(0, 16) + '…'

	loadPrefs()
	for (const el of [originInput, gidInput, cidInput, apiKeyInput])
		el?.addEventListener('change', savePrefs)

	await updateStorageStatus()

	connectBtn?.addEventListener('click', () => connect(db, identity).catch(e => log(String(e))))
	disconnectBtn?.addEventListener('click', () => {
		ws?.close()
		ws = null
	})

	/**
	 * 将输入框内容作为用户消息 POST 到群事件接口。
	 * @returns {Promise<void>} 无有意义返回值
	 */
	const postMessage = async () => {
		const origin = (originInput?.value || '').replace(/\/$/, '')
		const groupId = gidInput?.value?.trim()
		const channelId = cidInput?.value?.trim() || 'default'
		const text = (msgInput?.value || '').trim()
		if (!origin || !groupId) { log(geti18n(`${PREFIX}.groupFillOrigin`)); return }
		if (!text) { log(geti18n(`${PREFIX}.groupSendEmpty`)); return }
		savePrefs()

		const base = `${origin}/api/parts/shells:chat`
		try {
			const r = await fetch(`${base}/${encodeURIComponent(groupId)}/events`, fetchOpts({
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type: 'message',
					channelId,
					sender: identity.pubKeyHash,
					timestamp: Date.now(),
					content: {
						text: text.slice(0, 200_000),
						chatLogEntryId: crypto.randomUUID(),
						role: 'user',
					},
				}),
			}))
			if (!r.ok) { log(geti18n(`${PREFIX}.groupSendFail`, { status: r.status })); return }
			log(geti18n(`${PREFIX}.groupSendOk`))
			msgInput.value = ''
		}
		catch (e) {
			log(geti18n(`${PREFIX}.groupRestFail`, { msg: e?.message || e }))
		}
	}

	document.getElementById('send')?.addEventListener('click', postMessage)
	msgInput?.addEventListener('keydown', e => {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault()
			postMessage().catch(console.error)
		}
	})

	// 若 prefs 已有连接信息，自动连接
	if (originInput?.value && gidInput?.value)
		connect(db, identity).catch(e => log(String(e)))
}

void main()

