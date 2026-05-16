import { readFile } from 'node:fs/promises'

import { loadShellData } from '../../../../../../server/setting_loader.mjs'

import { snapshotPath, eventsPath } from './paths.mjs'
import { normalizeJsonBoundaryValue } from './remoteProxy.mjs'
import { computeArchiveSummary, recordGossipAllUnknownWant } from './reputation.mjs'

/** Trystero 单房间出站上限（§6.4）；溢出丢弃队列尾部（最低优先级）。 */
const FED_OUT_CAP = 64

/**
 * 联邦出站优先级队列：pri 越小越先发送。
 * @returns {{ enqueue: (pri: number, run: () => void) => void }} 出站调度
 */
function createFedOutQueue() {
	let seq = 0
	/** @type {{ pri: number, seq: number, run: () => void }[]} */
	const q = []
	let scheduled = false

	/** @returns {void} */
	function flush() {
		scheduled = false
		while (q.length) {
			const { run } = q.shift()
			try {
				run()
			}
			catch (e) {
				console.error('federation: outbound queue send failed', e)
			}
		}
	}

	return {
		/**
		 * @param {number} pri 0 DAG、1 gossip 请求、2 gossip 应答、3 identity/rpc、10 VOLATILE
		 * @param {() => void} run Trystero 发送闭包
		 * @returns {void}
		 */
		enqueue(pri, run) {
			seq++
			const item = { pri, seq, run }
			let lo = 0
			let hi = q.length
			while (lo < hi) {
				const mid = (lo + hi) >> 1
				const c = pri - q[mid].pri || item.seq - q[mid].seq
				if (c < 0) hi = mid
				else lo = mid + 1
			}
			q.splice(lo, 0, item)
			while (q.length > FED_OUT_CAP) q.pop()
			if (!scheduled) {
				scheduled = true
				queueMicrotask(flush)
			}
		},
	}
}

/**
 * @typedef {{
 *   nodeId: string
 *   readJsonl: (path: string) => Promise<object[]>
 *   appendValidatedRemoteEvent: (username: string, chatId: string, signPayload: object, opts?: { logFailures?: boolean }) => Promise<'ok' | 'dup' | 'invalid'>
 *   ingestRemoteEvent: (username: string, chatId: string, payload: unknown) => Promise<void>
 *   getStateForFederation?: (username: string, chatId: string) => Promise<{ state: object }>
 * }} FederationDagDeps
 */

/** @type {FederationDagDeps | null} */
let dagDeps = null

/**
 * 由 `dag.mjs` 在模块加载完成后注入，供联邦回调访问 DAG 读写与节点 ID。
 * @param {FederationDagDeps} deps 依赖集合
 * @returns {void} 无返回值
 */
export function initFederationDagDeps(deps) {
	dagDeps = deps
}

/**
 * @returns {FederationDagDeps} 已注入的 DAG 依赖；未初始化则抛出错误
 */
function requireDagDeps() {
	if (!dagDeps) throw new Error('federation: initFederationDagDeps must run before federation features')
	return dagDeps
}

/**
 * 读取聊天 Shell 的联邦（Trystero MQTT）配置。
 * @param {string} username 用户名
 * @returns {{ enabled: boolean, appId: string, password: string }} 是否启用、应用 ID 与连接口令
 */
export function getFederationConfig(username) {
	const data = loadShellData(username, 'chat', 'federation') || {}
	const enabled = !!data.enabled
	const appId = typeof data.appId === 'string' && data.appId.trim() ? data.appId.trim() : 'fount-group-fed'
	const password = typeof data.password === 'string' ? data.password : ''
	return { enabled, appId, password }
}

/**
 * @typedef {{
 *   trysteroRoomName: string,
 *   room: any,
 *   sendDag: (payload: unknown, peerId: string | null) => void,
 *   sendGossipRequest: (payload: unknown, peerId: string | null) => void,
 *   sendGossipResponse: (payload: unknown, peerId: string | null) => void,
 *   sendFedVolatile: (payload: unknown, peerId: string | null) => void,
 *   getRoster: () => Array<{ peerId: string, remoteNodeId: string | undefined }>,
 *   getPeerIdByNodeId: (nodeId: string) => string | null,
 *   sendToPeer: (peerId: string, actionName: string, payload: unknown) => void,
 * }} FederationSlot
 */

/** @type {Map<string, Promise<FederationSlot | null>>} */
const federationRoomInflight = new Map()
/** @type {Map<string, FederationSlot | null>} */
const federationRooms = new Map()
/** 与 `invalidateFederationRoomCache` / 房间名变更配合，丢弃过期的 join 结果。 */
/** @type {Map<string, number>} */
const federationRoomRebindGeneration = new Map()

const gossipRequestDedupe = new Map()
const GOSSIP_DEDUPE_MS = 30_000

/** @type {Map<string, Array<{ resolve: () => void, timer: ReturnType<typeof setTimeout> }>>} */
const pendingGossipRequests = new Map()
const GOSSIP_RESPONSE_WAIT_MS = 3000

/** 入站 wantIds 批处理速率：每邻居每窗口 §9 */
const GOSSIP_IN_WINDOW_MS = 60_000
const GOSSIP_IN_MAX_BATCH = 32
/** @type {Map<string, { count: number, resetAt: number }>} */
const gossipInboundWantRate = new Map()

/** 出站 gossip_request：每群每窗口 §9（本机发起补洞） */
const GOSSIP_OUT_WINDOW_MS = 60_000
const GOSSIP_OUT_MAX_BATCH = 16
/** @type {Map<string, { count: number, resetAt: number }>} */
const gossipOutboundWantRate = new Map()

/**
 * @param {string} username 用户名
 * @param {string} chatId 群 ID
 * @returns {boolean} 未超出站预算时为 true
 */
function takeOutgoingGossipWantSlot(username, chatId) {
	const key = `${username}\0${chatId}`
	const now = Date.now()
	let e = gossipOutboundWantRate.get(key)
	if (!e || now > e.resetAt)
		e = { count: 0, resetAt: now + GOSSIP_OUT_WINDOW_MS }
	if (e.count >= GOSSIP_OUT_MAX_BATCH) return false
	e.count++
	gossipOutboundWantRate.set(key, e)
	if (gossipOutboundWantRate.size > 4000)
		for (const [k, v] of gossipOutboundWantRate)
			if (now > v.resetAt + 120_000) gossipOutboundWantRate.delete(k)
	return true
}

/**
 * @param {string} username 用户名
 * @param {string} chatId 群 ID
 * @param {string} requesterId 对端节点 id
 * @returns {boolean} 未超限则为 true
 */
function takeIncomingGossipWantSlot(username, chatId, requesterId) {
	const key = `${username}\0${chatId}\0${requesterId}`
	const now = Date.now()
	let e = gossipInboundWantRate.get(key)
	if (!e || now > e.resetAt)
		e = { count: 0, resetAt: now + GOSSIP_IN_WINDOW_MS }

	if (e.count >= GOSSIP_IN_MAX_BATCH) return false
	e.count++
	gossipInboundWantRate.set(key, e)
	if (gossipInboundWantRate.size > 8000) 
		for (const [k, v] of gossipInboundWantRate)
			if (now > v.resetAt + 120_000) gossipInboundWantRate.delete(k)
	
	return true
}

const EVENT_ID_HEX = /^[0-9a-f]{64}$/iu

/**
 * §9 存档握手：严格对齐、可合并前缀、或本批 want 中至少一条本地可应答；分叉前沿拒绝整批且不记恶意。
 * @param {unknown} remoteArc 对端 `archiveSummary`
 * @param {{ hash: string, n: number, tip: string, cp: string }} localSummary 本机摘要
 * @param {object[]} localEvents 本机 DAG 行
 * @param {string[]} wantIds 本批请求的 id
 * @returns {{ allow: boolean, strictAligned: boolean }} allow=处理 want；strictAligned=摘要完全一致（仅此路径计「全不存在」恶意）
 */
function evaluateArchiveHandshake(remoteArc, localSummary, localEvents, wantIds) {
	if (localSummary.n === 0)
		return { allow: true, strictAligned: false }
	if (!remoteArc || typeof remoteArc !== 'object')
		return { allow: false, strictAligned: false }
	const o = /** @type {Record<string, unknown>} */ remoteArc
	if (o.v !== 1) return { allow: false, strictAligned: false }
	const rn = Number(o.n)
	if (!Number.isFinite(rn) || rn < 0) return { allow: false, strictAligned: false }
	if (rn === 0) return { allow: true, strictAligned: false }

	const byId = new Map(localEvents.map(e => [e.id, e]))
	const anyWantHit = wantIds.some(id => byId.has(id))

	const rh = typeof o.hash === 'string' ? o.hash.trim().toLowerCase() : ''
	const lh = (localSummary.hash || '').trim().toLowerCase()
	if (rh.length === 64 && lh.length === 64 && rh === lh)
		return { allow: true, strictAligned: true }

	const rtRaw = typeof o.tip === 'string' ? o.tip.trim().toLowerCase() : ''
	const rt = EVENT_ID_HEX.test(rtRaw) ? rtRaw : ''
	const lt = typeof localSummary.tip === 'string' && EVENT_ID_HEX.test(localSummary.tip)
		? localSummary.tip.trim().toLowerCase()
		: ''
	if (rt && byId.has(rt))
		return { allow: true, strictAligned: false }
	if (rt && lt && rt === lt)
		return { allow: true, strictAligned: false }
	if (anyWantHit)
		return { allow: true, strictAligned: false }
	return { allow: false, strictAligned: false }
}

/**
 * @param {{ hash: string, n: number, tip: string, cp: string }} s 本机 `computeArchiveSummary` 结果
 * @returns {{ v: number, hash: string, n: number, tip: string, cp: string }} 联邦载荷字段
 */
function wireArchiveSummary(s) {
	return {
		v: 1,
		hash: s.hash,
		n: s.n,
		tip: s.tip || '',
		cp: s.cp || '',
	}
}

/**
 * @param {string} username 用户名
 * @param {string} chatId 群 ID
 * @param {(path: string) => Promise<object[]>} readJsonl DAG 读行
 * @returns {Promise<{ events: object[], checkpoint: object | null, summary: { hash: string, n: number } }>} 本地事件、检查点与存档摘要
 */
async function loadLocalFederationArchive(username, chatId, readJsonl) {
	const events = await readJsonl(eventsPath(username, chatId))
	/** @type {object | null} */
	let checkpoint = null
	try {
		checkpoint = JSON.parse(await readFile(snapshotPath(username, chatId), 'utf8'))
	}
	catch { }
	return { events, checkpoint, summary: computeArchiveSummary(events, checkpoint) }
}

/**
 * @param {string} dedupeKey 去重键（请求者、wantIds、ttl）
 * @returns {boolean} 若为首次处理则返回 true
 */
function takeGossipRequestSlot(dedupeKey) {
	const now = Date.now()
	if (gossipRequestDedupe.size > 2000)
		for (const [k, t] of gossipRequestDedupe)
			if (t < now - GOSSIP_DEDUPE_MS) gossipRequestDedupe.delete(k)


	if (gossipRequestDedupe.has(dedupeKey)) return false
	gossipRequestDedupe.set(dedupeKey, now)
	return true
}

/**
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {string[]} wantIds 缺失事件 ID 列表
 * @returns {string} pending gossip 等待表键
 */
function gossipWaitKey(username, chatId, wantIds) {
	return `${username}\0${chatId}\0${[...wantIds].sort().join(',')}`
}

/**
 * 注册一次 gossip 响应等待：在收到含目标 ID 的 `gossip_response` 时提前结束，否则最长等待 `GOSSIP_RESPONSE_WAIT_MS`。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {string[]} wantIds 请求的缺失 ID 列表
 * @returns {Promise<void>}
 */
function waitForGossipProgress(username, chatId, wantIds) {
	const key = gossipWaitKey(username, chatId, wantIds)
	return new Promise(resolve => {
		const timer = setTimeout(() => {
			removeGossipWaiter(key, resolve, timer)
			resolve()
		}, GOSSIP_RESPONSE_WAIT_MS)
		let list = pendingGossipRequests.get(key)
		if (!list) {
			list = []
			pendingGossipRequests.set(key, list)
		}
		list.push({ resolve, timer })
	})
}

/**
 * @param {string} key gossipWaitKey
 * @param {() => void} resolve Promise resolve
 * @param {ReturnType<typeof setTimeout>} timer 超时句柄
 * @returns {void}
 */
function removeGossipWaiter(key, resolve, timer) {
	clearTimeout(timer)
	const list = pendingGossipRequests.get(key)
	if (!list) return
	const idx = list.findIndex(w => w.resolve === resolve && w.timer === timer)
	if (idx >= 0) list.splice(idx, 1)
	if (!list.length) pendingGossipRequests.delete(key)
}

/**
 * 立即结束某次 gossip 等待（例如未连接联邦或发送失败），避免挂起 3s 定时器。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {string[]} wantIds 与注册时相同的缺失 ID 列表
 * @returns {void}
 */
function forceResolveGossipWait(username, chatId, wantIds) {
	const key = gossipWaitKey(username, chatId, wantIds)
	const waiters = pendingGossipRequests.get(key)
	if (!waiters?.length) return
	for (const { resolve, timer } of [...waiters]) {
		clearTimeout(timer)
		removeGossipWaiter(key, resolve, timer)
		resolve()
	}
}

/**
 * 在收到 gossip 响应后，若事件 ID 命中某次 pending 请求所等待的集合，则立即结束对应等待。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {ReadonlySet<string>} receivedIds 本批响应中出现的事件 ID
 * @returns {void}
 */
function notifyGossipWaiters(username, chatId, receivedIds) {
	if (!receivedIds.size) return
	const prefix = `${username}\0${chatId}\0`
	for (const [key, waiters] of [...pendingGossipRequests]) {
		if (!key.startsWith(prefix)) continue
		const idsPart = key.slice(prefix.length)
		if (!idsPart) continue
		const wanted = new Set(idsPart.split(','))
		let hit = false
		for (const id of receivedIds)
			if (wanted.has(id)) {
				hit = true
				break
			}
		if (!hit) continue
		for (const { resolve, timer } of [...waiters]) {
			clearTimeout(timer)
			removeGossipWaiter(key, resolve, timer)
			resolve()
		}
	}
}

/**
 * 联邦 MQTT 连接在进程内缓存使用的复合键。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @returns {string} `username` 与 `chatId` 拼接后的 Map 键
 */
function federationRoomKey(username, chatId) {
	return `${username}\0${chatId}`
}

/**
 * Trystero 房间名：`groupMeta.dmKind === 'ecdh'` 且存在 `dmSessionTag` / `dmRoomLabelPrefix` 时用确定性 `dm:<tag>`，便于密钥 DM 与对端会合；否则为 `fount-fed-<groupId>`。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @returns {Promise<string>} MQTT 房间 id
 */
async function resolveTrysteroFedRoomName(username, chatId) {
	try {
		const d = requireDagDeps()
		const load = d.getStateForFederation
		if (!load) return `fount-fed-${chatId}`
		const { state } = await load(username, chatId)
		const m = state?.groupMeta
		if (m?.dmKind === 'ecdh') {
			const st = typeof m.dmSessionTag === 'string' ? m.dmSessionTag.trim().toLowerCase().replace(/^0x/iu, '') : ''
			if (/^[0-9a-f]{64}$/iu.test(st)) return `dm:${st}`
			const pre = typeof m.dmRoomLabelPrefix === 'string' ? m.dmRoomLabelPrefix.trim().toLowerCase().replace(/^0x/iu, '') : ''
			if (/^[0-9a-f]{8,64}$/iu.test(pre)) return `dm:${pre}`
		}
	}
	catch {
		/* 物化失败时回退默认房间名 */
	}
	return `fount-fed-${chatId}`
}

/**
 * 群联邦连接缓存失效（例如 `POST …/groups/new`（`template: dm`）写入 `group_meta_update` 后房间名从 `fount-fed-<id>` 变为 `dm:<tag>`）。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @returns {void}
 */
export function invalidateFederationRoomCache(username, chatId) {
	const key = federationRoomKey(username, chatId)
	federationRooms.delete(key)
	federationRoomInflight.delete(key)
	federationRoomRebindGeneration.set(key, (federationRoomRebindGeneration.get(key) || 0) + 1)
}

/**
 * 按需加入 Trystero MQTT 房间（见 `resolveTrysteroFedRoomName`）并订阅 `dag_event`；未启用或失败时返回 null。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @returns {Promise<FederationSlot | null>} 房间句柄与各类发送函数，或 null
 */
export async function ensureFederationRoom(username, chatId) {
	const { enabled, appId, password } = getFederationConfig(username)
	if (!enabled || !password) return null
	const key = federationRoomKey(username, chatId)
	const desiredRoomName = await resolveTrysteroFedRoomName(username, chatId)
	if (federationRooms.has(key)) {
		const existing = federationRooms.get(key)
		if (existing?.trysteroRoomName === desiredRoomName) return existing
		federationRooms.delete(key)
		federationRoomRebindGeneration.set(key, (federationRoomRebindGeneration.get(key) || 0) + 1)
	}
	if (federationRoomInflight.has(key)) return await federationRoomInflight.get(key)

	const p = (async () => {
		const genAtJoin = federationRoomRebindGeneration.get(key) || 0
		const { nodeId, readJsonl, ingestRemoteEvent } = requireDagDeps()
		const trysteroRoomName = await resolveTrysteroFedRoomName(username, chatId)
		try {
			const { joinMqttRoom } = await import('../../../../../../scripts/p2p/federation_trystero.mjs')
			const { RTCPeerConnection } = await import('npm:node-datachannel/polyfill')
			const room = await joinMqttRoom({
				appId,
				rtcPolyfill: RTCPeerConnection,
				password,
			}, trysteroRoomName)
			const fedOut = createFedOutQueue()

			/** @type {Map<string, string>} peerId → nodeId */
			const peerToNode = new Map()
			/** @type {Map<string, string>} nodeId → peerId */
			const nodeToPeer = new Map()
			/** @type {Map<string, (payload: unknown, peerId: string | null) => void>} */
			const senderRegistry = new Map()

			/**
			 * @param {string} name action 名称
			 * @returns {(payload: unknown, peerId: string | null) => void} 对应 action 的发送函数
			 */
			function getActionSender(name) {
				const cached = senderRegistry.get(name)
				if (cached) return cached
				const [send] = room.makeAction(name)
				senderRegistry.set(name, send)
				return send
			}

			const [sendIdentity, getIdentity] = room.makeAction('identity_announce')
			senderRegistry.set('identity_announce', sendIdentity)

			getIdentity((data, peerId) => {
				if (!data || typeof data !== 'object') return
				const nid = /** @type {{ nodeId?: unknown }} */ data.nodeId
				if (typeof nid !== 'string' || !nid) return
				const prev = peerToNode.get(peerId)
				if (prev) nodeToPeer.delete(prev)
				peerToNode.set(peerId, nid)
				nodeToPeer.set(nid, peerId)
			})

			room.onPeerJoin(peerId => {
				fedOut.enqueue(3, () => {
					try {
						sendIdentity({ nodeId }, peerId)
					}
					catch (e) {
						console.error('federation: identity_announce failed', e)
					}
				})
			})

			room.onPeerLeave(peerId => {
				const nid = peerToNode.get(peerId)
				if (nid) nodeToPeer.delete(nid)
				peerToNode.delete(peerId)
			})

			const [sendCharRpc, getCharRpc] = room.makeAction('char_rpc')
			senderRegistry.set('char_rpc', sendCharRpc)
			const [sendCharRpcResponse, getCharRpcResponse] = room.makeAction('char_rpc_response')
			senderRegistry.set('char_rpc_response', sendCharRpcResponse)

			getCharRpc((data, peerId) => {
				const request = parseCharRpcRequest(data)
				if (!request) return
				const { requestId, memberId, method, args } = request
				/**
				 *
				 */
				const handleCharRpc = async () => {
					const { tryInvokeLocalCharRpc } = await import('./session.mjs')
					const normalizedArgs = normalizeJsonBoundaryValue(args, `federation.char_rpc.args:${method}`)
					const result = await tryInvokeLocalCharRpc(chatId, memberId, method, normalizedArgs)
					let response
					if (result.kind === 'result')
						response = {
							type: 'rpc_end',
							requestId,
							// 明确在响应边界执行 JSON 校验，防止跨端 silent drop。
							result: normalizeJsonBoundaryValue(result.value, `federation.char_rpc.result:${method}`),
						}
					else if (result.kind === 'method_not_found')
						response = buildRpcErrorResponse(requestId, '方法不存在', 'METHOD_NOT_FOUND')
					else if (result.kind === 'not_local')
						return
					else
						response = buildRpcErrorResponse(requestId, String(result.message || '执行失败'), result.code)

					safeSendCharRpcResponse(sendCharRpcResponse, response, peerId)
				}
				void handleCharRpc().catch(e => {
					safeSendCharRpcResponse(
						sendCharRpcResponse,
						buildRpcErrorResponse(requestId, String(e?.message || e), e?.code),
						peerId,
					)
				})
			})

			getCharRpcResponse((data, _peerId) => {
				if (!isRecord(data)) return
				/**
				 *
				 */
				const handleCharRpcResponse = async () => {
					const { relayOrConsumeRpcResponse } = await import('./websocket.mjs')
					relayOrConsumeRpcResponse(chatId, null, data)
				}
				void handleCharRpcResponse().catch(e => console.error(e))
			})

			const [sendDagRaw, getDag] = room.makeAction('dag_event')
			getDag((data, _peerId) => {
				void ingestRemoteEvent(username, chatId, data).catch(e => console.error(e))
			})
			const [sendGossipRequestRaw, getGossipRequest] = room.makeAction('gossip_request')
			const [sendGossipResponseRaw, getGossipResponse] = room.makeAction('gossip_response')
			const [sendFedVolatileRaw, getFedVolatileRaw] = room.makeAction('fed_volatile')
			getFedVolatileRaw(() => {})
			getGossipRequest((data, peerId) => {
				void (async () => {
					if (!data || typeof data !== 'object') return
					const raw = /** @type {{ wantIds?: unknown, ttl?: unknown, requesterId?: unknown, archiveSummary?: unknown }} */ data
					const wantIds = Array.isArray(raw.wantIds)
						? [...new Set(raw.wantIds.filter(id => typeof id === 'string' && /^[0-9a-f]{64}$/iu.test(id)))]
						: []
					if (!wantIds.length) return
					const ttl = Number(raw.ttl)
					const requesterId = raw.requesterId
					if (!Number.isFinite(ttl) || typeof requesterId !== 'string' || !requesterId) return
					const { nodeId, readJsonl } = requireDagDeps()
					if (requesterId === nodeId) return
					const dedupeKey = `${requesterId}\0${wantIds.slice().sort().join(',')}\0${ttl}`
					if (!takeGossipRequestSlot(dedupeKey)) return
					if (!takeIncomingGossipWantSlot(username, chatId, requesterId)) return

					const localArchive = await loadLocalFederationArchive(username, chatId, readJsonl)
					const hs = evaluateArchiveHandshake(
						raw.archiveSummary,
						localArchive.summary,
						localArchive.events,
						wantIds,
					)
					if (!hs.allow) return

					const prev = localArchive.events
					const byId = new Map(prev.map(e => [e.id, e]))
					const allUnknown = wantIds.length > 0 && wantIds.every(id => !byId.has(id))
					if (allUnknown && prev.length > 0 && hs.strictAligned)
						void recordGossipAllUnknownWant(username, chatId, requesterId).catch(e => console.error(e))

					const events = wantIds.map(id => byId.get(id)).filter(Boolean)
					if (events.length && peerId)
						fedOut.enqueue(2, () => {
							try {
								sendGossipResponseRaw({ events, requesterId }, peerId)
							}
							catch (e) {
								console.error('federation: gossip_response failed', e)
							}
						})

					if (ttl > 0)
						fedOut.enqueue(1, () => {
							try {
								sendGossipRequestRaw({
									wantIds,
									ttl: ttl - 1,
									requesterId,
									archiveSummary: raw.archiveSummary,
								}, null)
							}
							catch (e) {
								console.error('federation: gossip_request forward failed', e)
							}
						})
				})().catch(e => console.error(e))
			})
			getGossipResponse((data, _peerId) => {
				void handleGossipResponse(username, chatId, data).catch(e => console.error(e))
			})
			/** @type {FederationSlot} */
			const slot = {
				trysteroRoomName,
				room,
				/**
				 * DAG 出站（prio 0，经联邦队列）。
				 * @param {unknown} payload 事件载荷
				 * @param {string | null} peerId Trystero 目标或对等广播用的 null
				 * @returns {void}
				 */
				sendDag: (payload, peerId) =>
					fedOut.enqueue(0, () => {
						try {
							sendDagRaw(payload, peerId)
						}
						catch (e) {
							console.error('federation: sendDag failed', e)
						}
					}),
				/**
				 * Gossip want 出站（prio 1）。
				 * @param {unknown} payload gossip 载荷
				 * @param {string | null} peerId 目标 peer
				 * @returns {void}
				 */
				sendGossipRequest: (payload, peerId) =>
					fedOut.enqueue(1, () => {
						try {
							sendGossipRequestRaw(payload, peerId)
						}
						catch (e) {
							console.error('federation: sendGossipRequest failed', e)
						}
					}),
				/**
				 * Gossip 应答出站（prio 2）。
				 * @param {unknown} payload 应答载荷
				 * @param {string | null} peerId 目标 peer
				 * @returns {void}
				 */
				sendGossipResponse: (payload, peerId) =>
					fedOut.enqueue(2, () => {
						try {
							sendGossipResponseRaw(payload, peerId)
						}
						catch (e) {
							console.error('federation: sendGossipResponse failed', e)
						}
					}),
				/**
				 * VOLATILE 等价最佳努力通道（prio 10，拥塞时先丢）。
				 * @param {unknown} payload 任意 JSON 可序列化体
				 * @param {string | null} peerId 目标或对等 null
				 * @returns {void}
				 */
				sendFedVolatile: (payload, peerId) =>
					fedOut.enqueue(10, () => {
						try {
							sendFedVolatileRaw(payload, peerId)
						}
						catch (e) {
							console.error('federation: sendFedVolatile failed', e)
						}
					}),
				/**
				 * @returns {{ peerId: string, remoteNodeId: string | undefined }[]} Trystero 对等端与本机推断的 `node_id`
				 */
				getRoster() {
					return [...peerToNode.entries()].map(([peerId, remoteNodeId]) => ({ peerId, remoteNodeId }))
				},
				/**
				 * @param {string} nodeId_ 目标节点 id
				 * @returns {string | null} 在线对应的 Trystero peerId，未知时为 null
				 */
				getPeerIdByNodeId(nodeId_) { return nodeToPeer.get(nodeId_) ?? null },
				/**
				 * @param {string} peerId 目标 Trystero peer id
				 * @param {string} actionName Trystero action 名称
				 * @param {unknown} payload 发送载荷
				 */
				sendToPeer(peerId, actionName, payload) { getActionSender(actionName)(payload, peerId) },
			}
			if ((federationRoomRebindGeneration.get(key) || 0) !== genAtJoin) return null
			federationRooms.set(key, slot)
			return slot
		}
		catch (e) {
			console.error('federation: joinMqttRoom failed', e)
			return null
		}
		finally {
			federationRoomInflight.delete(key)
		}
	})()
	federationRoomInflight.set(key, p)
	return p
}

/**
 * `GET .../peers`：本群 MQTT 房内可见对等端（未启用联邦则为空列表）。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @returns {Promise<{ selfNodeId: string, federationEnabled: boolean, peers: { peerId: string, remoteNodeId?: string }[] }>} 本机节点 id、是否启用联邦、对等端列表
 */
export async function listFederationPeersForGroup(username, groupId) {
	const { nodeId } = requireDagDeps()
	const cfg = getFederationConfig(username)
	if (!cfg.enabled)
		return { selfNodeId: nodeId, federationEnabled: false, peers: [] }
	const slot = await ensureFederationRoom(username, groupId)
	if (!slot?.getRoster)
		return { selfNodeId: nodeId, federationEnabled: true, peers: [] }
	const peers = slot.getRoster()
	const { recordExplorePeersFromRoster } = await import('./peers.mjs')
	void recordExplorePeersFromRoster(username, groupId, peers).catch(e => console.error('peers.json PEX merge failed', e))
	return { selfNodeId: nodeId, federationEnabled: true, peers }
}

/**
 * 统一映射 RPC 错误码：区分参数与返回边界非法。
 * @param {unknown} code 原始错误码或异常对象中的 code
 * @returns {string} 对外返回的稳定错误码
 */
function normalizeRpcErrorCode(code) {
	if (code === 'RPC_INVALID_ARGUMENT') return 'RPC_INVALID_ARGUMENT'
	if (code === 'RPC_INVALID_RESULT') return 'RPC_INVALID_RESULT'
	if (code === 'JSON_SERIALIZATION_ERROR') return 'JSON_SERIALIZATION_ERROR'
	if (code === 'METHOD_NOT_FOUND') return 'METHOD_NOT_FOUND'
	if (code === 'REMOTE_UNAVAILABLE') return 'REMOTE_UNAVAILABLE'
	return 'EXECUTION_ERROR'
}

/**
 * @param {unknown} value 待判定值
 * @returns {value is Record<string, unknown>} 是否为非 null 对象
 */
function isRecord(value) {
	return !!value && typeof value === 'object'
}

/**
 * @param {unknown} data `char_rpc` 原始载荷
 * @returns {{ requestId: string, memberId: string, method: string, args: unknown[] } | null} 解析后的请求；非法时为 null
 */
function parseCharRpcRequest(data) {
	if (!isRecord(data)) return null
	const { requestId, memberId, method, args } = data
	if (typeof requestId !== 'string' || !requestId) return null
	if (typeof memberId !== 'string' || !memberId) return null
	if (typeof method !== 'string' || !method) return null
	return { requestId, memberId, method, args: Array.isArray(args) ? args : [] }
}

/**
 * @param {string} requestId 请求 ID
 * @param {string} error 错误信息
 * @param {unknown} code 原始错误码
 * @returns {{ type: 'rpc_error', requestId: string, error: string, code: string }} 标准化 `rpc_error` 响应
 */
function buildRpcErrorResponse(requestId, error, code) {
	return {
		type: 'rpc_error',
		requestId,
		error,
		code: normalizeRpcErrorCode(code),
	}
}

/**
 * @param {(payload: unknown, peerId: string | null) => void} sendCharRpcResponse `char_rpc_response` 发送函数
 * @param {unknown} response 待发送响应
 * @param {string | null} peerId 目标 peerId
 * @returns {void}
 */
function safeSendCharRpcResponse(sendCharRpcResponse, response, peerId) {
	try { sendCharRpcResponse(response, peerId) }
	catch (e) { console.error('federation: char_rpc_response failed', e) }
}

/**
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {unknown} data `gossip_response` 载荷
 * @returns {Promise<void>}
 */
export async function handleGossipResponse(username, chatId, data) {
	const { nodeId, appendValidatedRemoteEvent } = requireDagDeps()
	if (!data || typeof data !== 'object') return
	const requesterId = /** @type {{ requesterId?: unknown }} */ data.requesterId
	if (requesterId !== nodeId) return
	const rawList = /** @type {{ events?: unknown }} */ data.events
	if (!Array.isArray(rawList)) return
	/** @type {Set<string>} */
	const receivedIds = new Set()
	for (const rawEv of rawList) {
		/** @type {unknown} */
		let ev = rawEv
		if (rawEv && typeof rawEv === 'object' && 'event' in /** @type {object} */ rawEv) {
			const wrapped = /** @type {{ event?: object }} */ rawEv.event
			if (wrapped && typeof wrapped === 'object') ev = wrapped
		}
		if (!ev || typeof ev !== 'object') continue
		const id = /** @type {{ id?: unknown }} */ ev.id
		if (typeof id === 'string' && /^[0-9a-f]{64}$/iu.test(id)) receivedIds.add(id)
		await appendValidatedRemoteEvent(username, chatId, /** @type {object} */ ev, { logFailures: false })
	}
	notifyGossipWaiters(username, chatId, receivedIds)
}

/**
 * 按 ID 查询本地已有事件；可选合并 `peerEvents` 中经签名校验的条目（供离线互传或后续联邦扩展）。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {{ missingEventIds?: string[], wantIds?: string[], eventIds?: string[], peerEvents?: unknown[] }} [query] 查询与可选对端事件
 * @returns {Promise<{ found: boolean, events: object[], stillMissing: string[], mergedFromPeer: number }>} 是否凑齐、已命中事件、仍缺 ID、合并条数
 */
export async function requestMissingEventsGossip(username, chatId, query = {}) {
	const { nodeId, readJsonl, appendValidatedRemoteEvent } = requireDagDeps()
	const raw = query.missingEventIds ?? query.wantIds ?? query.eventIds
	const wantIds = Array.isArray(raw)
		? [...new Set(raw.filter(id => typeof id === 'string' && /^[0-9a-f]{64}$/iu.test(id)))]
		: []

	let mergedFromPeer = 0
	const peerEvents = Array.isArray(query.peerEvents) ? query.peerEvents : []
	for (const rawEv of peerEvents) {
		/** @type {unknown} */
		let ev = rawEv
		if (rawEv && typeof rawEv === 'object' && 'event' in /** @type {object} */ rawEv) {
			const wrapped = /** @type {{ event?: object }} */ rawEv.event
			if (wrapped && typeof wrapped === 'object') ev = wrapped
		}
		if (!ev || typeof ev !== 'object') continue
		const r = await appendValidatedRemoteEvent(username, chatId, /** @type {object} */ ev, { logFailures: false })
		if (r === 'ok') mergedFromPeer++
	}

	const events = await readJsonl(eventsPath(username, chatId))
	const byId = new Map(events.map(e => [e.id, e]))
	const filled = wantIds.map(id => byId.get(id)).filter(Boolean)
	const stillMissing = wantIds.filter(id => !byId.has(id))
	const found = wantIds.length === 0 || stillMissing.length === 0

	if (stillMissing.length)
		void (async function requestMissingEventsFromFederation() {
			const waitP = waitForGossipProgress(username, chatId, stillMissing)
			const slot = await ensureFederationRoom(username, chatId)
			if (!slot?.sendGossipRequest) {
				forceResolveGossipWait(username, chatId, stillMissing)
				return
			}
			if (!takeOutgoingGossipWantSlot(username, chatId)) {
				forceResolveGossipWait(username, chatId, stillMissing)
				return
			}
			const { readJsonl } = requireDagDeps()
			const localArchive = await loadLocalFederationArchive(username, chatId, readJsonl)
			const archiveSummary = wireArchiveSummary(localArchive.summary)
			try {
				slot.sendGossipRequest({
					wantIds: [...stillMissing],
					ttl: 2,
					requesterId: nodeId,
					archiveSummary,
				}, null)
			}
			catch (e) {
				console.error('federation: gossip_request failed', e)
				forceResolveGossipWait(username, chatId, stillMissing)
				return
			}
			await waitP
		})().catch(e => console.error(e))


	return { found, events: filled, stillMissing, mergedFromPeer }
}

/**
 *
 */
export {
	GROUP_RPC_TARGET_NODE_ID_KEY,
	isValidGroupRpcClientNodeId,
	resolveTargetNodeIdFromSourceHost,
	sendRpcToNode,
	shouldAcceptDirectedGroupRpc,
	withDirectedGroupRpcTarget,
} from './remoteProxy.mjs'
