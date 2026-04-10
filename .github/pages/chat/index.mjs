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

import { geti18n, initTranslations } from '../scripts/i18n.mjs'

const PREFIX = 'chat.group.ghpages'
const STORAGE_KEY = 'fount-ghpages-group'
const DB_NAME = 'fount-ghpages'
const DB_VERSION = 2

/** @param {string} key @param {Record<string,string|number>} [vars] */
function t(key, vars = {}) {
	let s = geti18n(`${PREFIX}.${key}`, vars)
	if (!s || s === `${PREFIX}.${key}`) s = geti18n(key, vars) || key
	return s
}

// ─── DOM refs ───────────────────────────────────────────────────────────────

const originInput = /** @type {HTMLInputElement} */ (document.getElementById('origin'))
const gidInput = /** @type {HTMLInputElement} */ (document.getElementById('gid'))
const cidInput = /** @type {HTMLInputElement} */ (document.getElementById('cid'))
const apiKeyInput = /** @type {HTMLInputElement} */ (document.getElementById('apikey'))
const msgInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('msg'))
const connectBtn = document.getElementById('connect')
const disconnectBtn = document.getElementById('disconnect')
const logEl = document.getElementById('log')
const messagesEl = document.getElementById('messages-inner')
const streamIndicator = document.getElementById('stream-indicator')
const connStatus = document.getElementById('conn-status')
const cpStatus = document.getElementById('checkpoint-status')
const storageStatus = document.getElementById('storage-status')
const pubkeyDisplay = document.getElementById('pubkey-display')

// ─── IndexedDB helpers ───────────────────────────────────────────────────────

/** @returns {Promise<IDBDatabase>} */
function openDb() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = () => {
			const db = req.result
			if (!db.objectStoreNames.contains('identity'))
				db.createObjectStore('identity', { keyPath: 'id' })
			if (!db.objectStoreNames.contains('messages'))
				db.createObjectStore('messages', { keyPath: 'key' }) // key = `${groupId}:${channelId}:${eventId}`
			if (!db.objectStoreNames.contains('checkpoints'))
				db.createObjectStore('checkpoints', { keyPath: 'groupId' })
		}
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
}

/** @param {IDBDatabase} db @param {string} store @param {string} key */
function dbGet(db, store, key) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readonly')
		const r = tx.objectStore(store).get(key)
		r.onsuccess = () => resolve(r.result)
		r.onerror = () => reject(r.error)
	})
}

/** @param {IDBDatabase} db @param {string} store @param {object} value */
function dbPut(db, store, value) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readwrite')
		const r = tx.objectStore(store).put(value)
		r.onsuccess = () => resolve()
		r.onerror = () => reject(r.error)
	})
}

/** @param {IDBDatabase} db @param {string} store */
function dbGetAll(db, store) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readonly')
		const r = tx.objectStore(store).getAll()
		r.onsuccess = () => resolve(r.result || [])
		r.onerror = () => reject(r.error)
	})
}

// ─── Ed25519 identity ────────────────────────────────────────────────────────

/**
 * @param {IDBDatabase} db
 * @returns {Promise<{ privKeyHex: string, pubKeyHex: string, pubKeyHash: string, displayName: string }>}
 */
async function getOrCreateIdentity(db) {
	let identity = await dbGet(db, 'identity', 'self')
	if (!identity) {
		const { ed25519 } = await import('https://esm.sh/@noble/ed25519@2')
		const privKey = ed25519.utils.randomPrivateKey()
		const pubKey = await ed25519.getPublicKeyAsync(privKey)
		const hashBuf = await crypto.subtle.digest('SHA-256', pubKey)
		const hashArr = new Uint8Array(hashBuf)
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

/** @param {string} sid @returns {{ chunks: Map<number,string>, done: boolean, el: HTMLElement | null }} */
function getStreamBuf(sid) {
	if (!streamBufs.has(sid))
		streamBufs.set(sid, { chunks: new Map(), done: false, el: null })
	return streamBufs.get(sid)
}

/**
 * @param {string} sid
 * @param {number} seq
 * @param {string} text
 * @param {(sid:string, seq:number) => void} nack  发送 NACK 的回调
 */
function addStreamChunk(sid, seq, text, nack) {
	const buf = getStreamBuf(sid)
	buf.chunks.set(seq, text)
	// 找连续前缀
	let i = 0
	const parts = []
	while (buf.chunks.has(i)) parts.push(buf.chunks.get(i++))
	const content = parts.join('')
	// 检测缺口
	const maxSeq = Math.max(...buf.chunks.keys())
	for (let j = i; j <= maxSeq; j++)
		if (!buf.chunks.has(j)) nack(sid, j)
	// 更新 UI
	if (!buf.el) {
		buf.el = document.createElement('div')
		buf.el.className = 'text-sm italic opacity-70 bg-base-200 rounded px-2 py-1'
		messagesEl?.appendChild(buf.el)
	}
	const gap = i <= maxSeq ? ' …' : ''
	buf.el.textContent = `[AI] ${content}${gap}`
	messagesEl?.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' })
	streamIndicator?.classList.remove('hidden')
}

/** @param {string} sid */
function endStream(sid) {
	const buf = streamBufs.get(sid)
	if (buf) {
		buf.done = true
		buf.el?.classList.remove('italic', 'opacity-70')
	}
	streamIndicator?.classList.add('hidden')
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

function log(line) {
	if (!logEl) return
	logEl.textContent += `${line}\n`
	logEl.scrollTop = logEl.scrollHeight
}

function setConnStatus(s) {
	if (connStatus) connStatus.textContent = s
}

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

async function updateStorageStatus() {
	try {
		if (!navigator.storage?.estimate) return
		const { usage = 0, quota = 0 } = await navigator.storage.estimate()
		const fmt = n => n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`
		if (storageStatus)
			storageStatus.textContent = `IndexedDB: ${fmt(usage)} / ${fmt(quota)}`
	}
	catch { /* ignore */ }
}

// ─── Prefs ───────────────────────────────────────────────────────────────────

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

function authHeaders() {
	const tok = apiKeyInput?.value?.trim()
	return tok ? { Authorization: `Bearer ${tok}` } : {}
}

function fetchOpts(init = {}) {
	const token = apiKeyInput?.value?.trim()
	const { headers: h0 = {}, ...rest } = init
	return { mode: 'cors', credentials: token ? 'omit' : 'include', ...rest, headers: { ...h0, ...authHeaders() } }
}

// ─── Core session state ──────────────────────────────────────────────────────

let ws = null
let lastEventId = null

async function sendNack(pendingStreamId, missingSeq) {
	if (!ws || ws.readyState !== WebSocket.OPEN) return
	try {
		ws.send(JSON.stringify({ type: 'stream_chunk_nack', pendingStreamId, missingSeq }))
	}
	catch { /* ignore */ }
}

async function loadCheckpoint(db, groupId, origin) {
	const base = `${origin}/api/parts/shells:chat`
	try {
		const r = await fetch(`${base}/${encodeURIComponent(groupId)}/checkpoint`, fetchOpts())
		if (!r.ok) {
			log(t('groupCpFail', { status: r.status }))
			return null
		}
		const cp = await r.json()
		await dbPut(db, 'checkpoints', { groupId, ...cp })
		if (cpStatus)
			cpStatus.textContent = `Checkpoint epoch:${cp.epoch_id ?? '?'}`
		log(t('groupCpOk', { epoch: cp.epoch_id ?? '?', pins: '{}' }))
		return cp
	}
	catch (e) {
		log(t('groupRestFail', { msg: e?.message || e }))
		return null
	}
}

async function loadMessages(db, groupId, channelId, origin) {
	const base = `${origin}/api/parts/shells:chat`
	try {
		const url = `${base}/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/messages?limit=50${lastEventId ? `&before=${encodeURIComponent(lastEventId)}` : ''}`
		const r = await fetch(url, fetchOpts())
		if (!r.ok) {
			log(t('groupMsgFail', { status: r.status }))
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
		log(t('groupMsgOk', { n: messages.length }))
		await updateStorageStatus()
	}
	catch (e) {
		log(t('groupRestFail', { msg: e?.message || e }))
	}
}

async function connect(db, identity) {
	const origin = (originInput?.value || '').replace(/\/$/, '')
	const groupId = gidInput?.value?.trim()
	const channelId = cidInput?.value?.trim() || 'default'
	if (!origin || !groupId) {
		log(t('groupFillOrigin'))
		return
	}
	savePrefs()

	if (ws) {
		ws.close()
		ws = null
	}

	setConnStatus(t('ghpagesConnecting'))
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
	const wsUrl = `${proto}//${u.host}/ws/parts/shells:chat/group/${encodeURIComponent(groupId)}`
	const token = apiKeyInput?.value?.trim()
	log(t('groupWsConnecting', { url: wsUrl }))

	ws = token ? new WebSocket(wsUrl, [token]) : new WebSocket(wsUrl)

	ws.onopen = () => {
		setConnStatus(t('ghpagesConnected'))
		log(t('groupWsOpen'))
		connectBtn?.classList.add('hidden')
		disconnectBtn?.classList.remove('hidden')
	}

	ws.onclose = () => {
		setConnStatus(t('ghpagesDisconnected'))
		log(t('groupWsClose'))
		connectBtn?.classList.remove('hidden')
		disconnectBtn?.classList.add('hidden')
	}

	ws.onerror = () => log(t('groupWsError'))

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
				if (sid) addStreamChunk(sid, seq, text, (s, n) => sendNack(s, n))
			}
			else if (msg.type === 'group_stream_end' || msg.type === 'stream_end') {
				const sid = msg.pendingStreamId || msg.pending_stream_id
				if (sid) endStream(sid)
			}
			else if (msg.type === 'dag_event') {
				log(t('groupLogDag', { id: msg.event?.id || '?' }))
			}
			else {
				log(t('groupLogEvent', { type: msg.type || '?' }))
			}
		}
		catch { log(ev.data.slice(0, 120)) }
	}

	// 拉 Checkpoint 中的状态摘要
	if (cp) {
		const chCount = Object.keys(cp.channels || {}).length
		log(t('groupStateOk', { n: chCount }))
	}
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
	await initTranslations('chat.group.ghpages')
	document.title = t('title')
	const dm = document.querySelector('meta[name="description"]')
	if (dm) dm.content = t('description')

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

	const postMessage = async () => {
		const origin = (originInput?.value || '').replace(/\/$/, '')
		const groupId = gidInput?.value?.trim()
		const channelId = cidInput?.value?.trim() || 'default'
		const text = (msgInput?.value || '').trim()
		if (!origin || !groupId) { log(t('groupFillOrigin')); return }
		if (!text) { log(t('groupSendEmpty')); return }
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
			if (!r.ok) { log(t('groupSendFail', { status: r.status })); return }
			log(t('groupSendOk'))
			msgInput.value = ''
		}
		catch (e) {
			log(t('groupRestFail', { msg: e?.message || e }))
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

