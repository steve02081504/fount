import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, appendFile, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** IP 限流：{ip} -> { count, resetAt } */
const ipWsRequests = new Map()
const IP_WS_WINDOW_MS = 60_000
const IP_WS_MAX = 60

/**
 * WS 升级前 IP 限流检查（每分钟最多 60 次）。
 * @param {string} ip
 * @returns {boolean} true=允许，false=拒绝
 */
export function checkWsIpRateLimit(ip) {
	const now = Date.now()
	let entry = ipWsRequests.get(ip)
	if (!entry || now > entry.resetAt) {
		entry = { count: 0, resetAt: now + IP_WS_WINDOW_MS }
		ipWsRequests.set(ip, entry)
	}
	entry.count++
	return entry.count <= IP_WS_MAX
}

import { getUserDictionary } from '../../../../../server/auth.mjs'
import { loadShellData } from '../../../../../server/setting_loader.mjs'
import {
	computeEventId,
	signPayloadBytes,
	topologicalCanonicalOrder,
} from '../../../../../scripts/p2p/dag.mjs'
import { pubKeyHash, sign, verify } from '../../../../../scripts/p2p/crypto.mjs'
import { nextHlc } from '../../../../../scripts/p2p/hlc.mjs'
import {
	adminPubKeyHashes,
	emptyMaterializedState,
	foldAuthzEvent,
	memberChannelPermissions,
} from '../../../../../scripts/p2p/materialized_state.mjs'
import { verifyHomeTransferThreshold, verifyOwnerSuccessionThreshold } from '../../../../../scripts/p2p/home_transfer_ballot.mjs'
import { groupDefaultString } from './group_i18n_defaults.mjs'
import { buildCheckpointPayload, buildFileFoldersSnapshot } from '../../../../../scripts/p2p/checkpoint.mjs'
import { createLocalStoragePlugin } from '../../../../../scripts/p2p/storage_plugins.mjs'
import { DEFAULT_MAX_CATCHUP_EVENTS, EPOCH_CHAIN_MAX } from '../../../../../scripts/p2p/constants.mjs'

/** @type {Map<string, Set<import('npm:websocket-express').WebSocket>>} */
const groupSockets = new Map()

const NODE_ID = randomUUID()

/** GET /pow-challenge 下发的质询，单次使用 */
/** @type {Map<string, { challenge: string, expires: number }>} */
const powChallengesByUserGroup = new Map()

function powChallengeKey(username, groupId) {
	return `${username}\0${groupId}`
}

/**
 * 注册 PoW 质询（由 GET …/pow-challenge 调用，约 10 分钟内有效）。
 * @param {string} username
 * @param {string} groupId
 * @param {string} challenge
 * @param {number} [ttlMs]
 */
export function setPowChallengeForGroup(username, groupId, challenge, ttlMs = 600_000) {
	powChallengesByUserGroup.set(powChallengeKey(username, groupId), {
		challenge,
		expires: Date.now() + ttlMs,
	})
}

/**
 * 校验 PoW：`sha256(utf8(\`${groupId}:${challenge}:${nonce}\`))` 的 hex 字符串前 `difficulty` 个字符均为 `0`。
 * 须与已注册的 challenge 一致，通过后删除质询（单次使用）。
 * @param {string} username
 * @param {string} groupId
 * @param {number} difficulty 0–64，为 0 时视为不校验
 * @param {{ challenge?: unknown, nonce?: unknown }} [powSolution]
 * @returns {boolean}
 */
export function verifyPowSolution(username, groupId, difficulty, powSolution) {
	const d = Math.max(0, Math.min(64, Math.floor(Number(difficulty) || 0)))
	if (d <= 0) return true
	if (!powSolution || typeof powSolution !== 'object') return false
	const ch = powSolution.challenge
	const nonce = powSolution.nonce
	if (ch == null || nonce == null) return false
	const key = powChallengeKey(username, groupId)
	const entry = powChallengesByUserGroup.get(key)
	if (!entry || entry.expires < Date.now()) return false
	if (String(ch) !== entry.challenge) return false
	const hex = createHash('sha256')
		.update(`${groupId}:${String(ch)}:${String(nonce)}`, 'utf8')
		.digest('hex')
	if (!hex.startsWith('0'.repeat(d))) return false
	powChallengesByUserGroup.delete(key)
	return true
}

/** 写入频道 messages/*.jsonl 的事件类型（与 appendGroupEvent 一致） */
const PERSIST_MESSAGE_TYPES = new Set([
	'message', 'message_edit', 'message_delete', 'message_feedback',
	'vote_cast', 'pin_message', 'unpin_message',
	'reaction_add', 'reaction_remove',
])

/**
 * 联邦配置：`loadShellData(username, 'chat', 'federation')`
 * - enabled: 是否加入 Trystero MQTT 房间并同步 DAG
 * - appId: MQTT 应用 id（默认 fount-group-fed）
 * - password: 与对端一致的房间密码（空则不同步）
 * @param {string} username
 */
function getFederationConfig(username) {
	const data = loadShellData(username, 'chat', 'federation') || {}
	const enabled = !!data.enabled
	const appId = typeof data.appId === 'string' && data.appId.trim() ? data.appId.trim() : 'fount-group-fed'
	const password = typeof data.password === 'string' ? data.password : ''
	return { enabled, appId, password }
}

/** @type {Map<string, Promise<{ room: any, sendDag: (payload: unknown, peerId: string | null) => void } | null>>} */
const federationRoomInflight = new Map()
/** @type {Map<string, { room: any, sendDag: (payload: unknown, peerId: string | null) => void } | null>} */
const federationRooms = new Map()

function federationRoomKey(username, groupId) {
	return `${username}\0${groupId}`
}

/**
 * DAG 事件已写入 events.jsonl 后：WS 广播、频道消息行、checkpoint（本地追加与远程入库共用）。
 * @param {string} username
 * @param {string} groupId
 * @param {object} signPayload
 */
async function broadcastAndPersistAfterSignedEvent(username, groupId, signPayload) {
	broadcastGroupEvent(groupId, { type: 'dag_event', event: signPayload })
	if (!PERSIST_MESSAGE_TYPES.has(signPayload.type)) {
		await rebuildAndSaveCheckpoint(username, groupId)
		return
	}
	const ch = signPayload.channelId || signPayload.content?.channelId || 'default'
	const msgLine = {
		eventId: signPayload.id,
		type: signPayload.type,
		content: signPayload.content,
		sender: signPayload.sender,
		charId: signPayload.charId,
		timestamp: signPayload.timestamp,
		receivedAt: signPayload.received_at,
	}
	const mp = messagesPath(username, groupId, ch)
	await mkdir(join(mp, '..'), { recursive: true })
	await appendFile(mp, `${JSON.stringify(msgLine)}\n`, 'utf8')
	broadcastGroupEvent(groupId, { type: 'channel_message', channelId: ch, message: msgLine })
	await rebuildAndSaveCheckpoint(username, groupId)
	// 仅对普通消息触发 AI 定频自动回复（reaction/pin 等不触发）
	if (signPayload.type === 'message')
		void maybeAutoTriggerCharReply(username, groupId, ch).catch(() => {})
}

/**
 * 校验并入库远程 DAG 事件（不再次向联邦广播，避免回环）。
 * @param {string} username
 * @param {string} groupId
 * @param {unknown} payload Trystero 收到的对象或 { event }
 */
async function ingestRemoteGroupEvent(username, groupId, payload) {
	let signPayload = payload
	if (payload && typeof payload === 'object' && 'event' in /** @type {object} */ (payload)
		&& typeof /** @type {{ event?: object }} */ (payload).event === 'object'
		&& /** @type {{ event?: object }} */ (payload).event)
		signPayload = /** @type {{ event: object }} */ (payload).event
	if (!signPayload || typeof signPayload !== 'object') return
	const sp = /** @type {Record<string, unknown>} */ (signPayload)
	if (!sp.id || typeof sp.id !== 'string') return

	const path = eventsPath(username, groupId)
	const prev = await readJsonl(path)
	if (prev.some(e => e.id === sp.id)) return

	const bodyForId = unsignedEventFields(/** @type {object} */ (signPayload))
	if (computeEventId(bodyForId) !== sp.id) {
		console.error('federation: drop remote event (id mismatch)')
		return
	}

	try {
		await validateEd25519Signature(username, groupId, bodyForId, /** @type {any} */ (signPayload), /** @type {any} */ (signPayload), undefined)
	}
	catch (e) {
		console.error('federation: drop remote event (signature)', e)
		return
	}

	await appendJsonl(path, signPayload)
	await broadcastAndPersistAfterSignedEvent(username, groupId, /** @type {object} */ (signPayload))
}

/**
 * 加入 `fount-fed-${groupId}` MQTT 房间并订阅 `dag_event`；失败返回 null。
 * @param {string} username
 * @param {string} groupId
 * @returns {Promise<{ room: any, sendDag: (payload: unknown, peerId: string | null) => void } | null>}
 */
async function ensureFederationRoom(username, groupId) {
	const { enabled, appId, password } = getFederationConfig(username)
	if (!enabled || !password) return null
	const key = federationRoomKey(username, groupId)
	if (federationRooms.has(key)) return federationRooms.get(key)
	if (federationRoomInflight.has(key)) return await federationRoomInflight.get(key)

	const p = (async () => {
		try {
			const { joinMqttRoom } = await import('../../../../../scripts/p2p/federation_trystero.mjs')
			const { RTCPeerConnection } = await import('npm:node-datachannel/polyfill')
			const room = await joinMqttRoom({
				appId,
				rtcPolyfill: RTCPeerConnection,
				password,
			}, `fount-fed-${groupId}`)
			const [sendDag, getDag] = room.makeAction('dag_event')
			getDag((data, _peerId) => {
				void ingestRemoteGroupEvent(username, groupId, data).catch(e => console.error(e))
			})
			const slot = { room, sendDag }
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
 * 本地写入成功后向联邦广播已签名事件（Trystero：send(payload, null) 表示全员）。
 * @param {string} username
 * @param {string} groupId
 * @param {object} signPayload
 */
async function publishSignedEventToFederation(username, groupId, signPayload) {
	const slot = await ensureFederationRoom(username, groupId)
	if (!slot?.sendDag) return
	try {
		slot.sendDag(signPayload, null)
	}
	catch (e) {
		console.error('federation: publish failed', e)
	}
}

function groupDir(username, groupId) {
	return join(getUserDictionary(username), 'shells', 'chat', 'groups', groupId)
}

function eventsPath(username, groupId) {
	return join(groupDir(username, groupId), 'events.jsonl')
}

function checkpointPath(username, groupId) {
	return join(groupDir(username, groupId), 'checkpoint.json')
}

function messagesPath(username, groupId, channelId) {
	return join(groupDir(username, groupId), 'messages', `${channelId}.jsonl`)
}

/**
 * @param {string} groupId
 * @param {import('npm:websocket-express').WebSocket} ws
 */
export function registerGroupSocket(groupId, ws) {
	if (!groupSockets.has(groupId)) groupSockets.set(groupId, new Set())
	groupSockets.get(groupId).add(ws)
	ws.on('close', () => {
		groupSockets.get(groupId)?.delete(ws)
	})
}

/**
 * @param {string} groupId
 * @param {object} payload
 */
export function broadcastGroupEvent(groupId, payload) {
	const set = groupSockets.get(groupId)
	if (!set) return
	const raw = JSON.stringify({ ...payload, t: Date.now() })
	for (const ws of set)
		try {
			ws.send(raw)
		}
		catch (e) {
			console.error('group broadcast failed', e)
		}
}

async function readJsonl(path) {
	try {
		const text = await readFile(path, 'utf8')
		return text.split('\n').filter(Boolean).map(line => JSON.parse(line))
	}
	catch {
		return []
	}
}

async function appendJsonl(path, obj) {
	await mkdir(dirname(path), { recursive: true })
	await appendFile(path, `${JSON.stringify(obj)}\n`, 'utf8')
}

/**
 * @param {object} e
 */
function unsignedEventFields(e) {
	return {
		type: e.type,
		groupId: e.groupId,
		channelId: e.channelId,
		sender: e.sender,
		charId: e.charId,
		timestamp: e.timestamp,
		hlc: e.hlc,
		prev_event_id: e.prev_event_id ?? null,
		content: e.content,
		node_id: e.node_id,
	}
}

const PUB_KEY_HASH_HEX = /^[0-9a-f]{64}$/iu

/**
 * Ed25519：sender 为 64 位 hex（成员 pubKeyHash）时必须带有效签名；本地别名 sender 可无签名。
 * @param {string} username
 * @param {string} groupId
 * @param {object} body unsignedEventFields(base)
 * @param {{ id: string, signature?: string, senderPubKey?: string }} signPayload
 * @param {{ senderPubKey?: string }} eventLike
 * @param {Uint8Array} [secretKey] 本地签名时用于推导公钥并验签
 */
async function validateEd25519Signature(username, groupId, body, signPayload, eventLike, secretKey) {
	const sender = String(body.sender || '')
	const sigHex = typeof signPayload.signature === 'string' ? signPayload.signature.trim() : ''
	const sigBytes = sigHex ? Buffer.from(sigHex, 'hex') : null
	const hasSig = !!(sigBytes && sigBytes.length === 64)

	if (!PUB_KEY_HASH_HEX.test(sender)) {
		if (!hasSig) return
		const pkHex = eventLike.senderPubKey || signPayload.senderPubKey
		if (!pkHex || String(pkHex).length !== 64)
			throw new Error('signature present but missing sender public key')
		const pk = Buffer.from(String(pkHex), 'hex')
		if (pk.length !== 32) throw new Error('Invalid senderPubKey length')
		const ok = await verify(new Uint8Array(sigBytes), signPayloadBytes(body), new Uint8Array(pk))
		if (!ok) throw new Error('Invalid event signature')
		return
	}

	if (!hasSig) throw new Error('signed events require signature (sender is pubKeyHash)')

	/** @type {Uint8Array | null} */
	let pkBytes = null
	if (secretKey) {
		const { getPublicKey } = await import('npm:@noble/ed25519')
		pkBytes = getPublicKey(secretKey.slice(0, 32))
	}
	else {
		const pkHex = eventLike.senderPubKey || signPayload.senderPubKey
		if (pkHex && String(pkHex).length === 64) {
			const buf = Buffer.from(String(pkHex), 'hex')
			if (buf.length === 32) pkBytes = new Uint8Array(buf)
		}
		if (!pkBytes) {
			const c = eventLike.content && typeof eventLike.content === 'object' ? eventLike.content : {}
			const fromContent = c.pubKeyHex || c.pubKey
			if (fromContent && String(fromContent).length === 64) {
				const buf = Buffer.from(String(fromContent).replace(/^0x/iu, ''), 'hex')
				if (buf.length === 32) pkBytes = new Uint8Array(buf)
			}
		}
		if (!pkBytes) {
			const { state } = await getGroupState(username, groupId)
			const m = state.members.get(sender)
			const hex = m?.pubKeyHex
			if (hex) {
				const buf = Buffer.from(String(hex).replace(/^0x/iu, ''), 'hex')
				if (buf.length === 32) pkBytes = new Uint8Array(buf)
			}
		}
	}
	if (!pkBytes) throw new Error('cannot verify: missing public key for sender hash')

	if (pubKeyHash(pkBytes).toLowerCase() !== sender.toLowerCase())
		throw new Error('sender public key does not match sender hash')

	const ok = await verify(new Uint8Array(sigBytes), signPayloadBytes(body), pkBytes)
	if (!ok) throw new Error('Invalid event signature')
}

/**
 * @param {string} username
 * @param {object} body
 */
export async function createGroup(username, body) {
	const groupId = body.groupId || randomUUID()
	const dir = groupDir(username, groupId)
	await mkdir(dir, { recursive: true })
	const genesisBase = {
		type: 'group_meta_update',
		groupId,
		sender: body.ownerPubKeyHash || 'local',
		timestamp: Date.now(),
		hlc: { wall: Date.now(), logical: 0 },
		prev_event_id: null,
		content: { name: body.name || groupDefaultString('groupMetaName'), desc: body.desc || '' },
		node_id: NODE_ID,
	}
	const id = computeEventId(unsignedEventFields(genesisBase))
	const signPayload = { ...unsignedEventFields(genesisBase), id, signature: '' }
	await mkdir(groupDir(username, groupId), { recursive: true })
	await writeFile(eventsPath(username, groupId), `${JSON.stringify(signPayload)}\n`, 'utf8')

	await appendGroupEvent(username, groupId, {
		type: 'channel_create',
		sender: 'local',
		timestamp: Date.now(),
		content: {
			channelId: 'default',
			type: 'text',
			name: body.defaultChannelName || groupDefaultString('defaultChannelName'),
			syncScope: 'group',
		},
	})

	const s = await getGroupState(username, groupId)
	return { groupId, checkpoint: s.checkpoint }
}

/**
 * 每个聊天会话（chatId）对应一个群（groupId === chatId）。若尚无 DAG 数据则创建。
 * @param {string} username
 * @param {string} chatId 与聊天页 chatId 相同
 * @param {object} [options]
 * @param {string} [options.name] 群显示名
 * @param {string} [options.defaultChannelName]
 * @returns {Promise<{ groupId: string, created: boolean }>}
 */
export async function ensureGroupForChat(username, chatId, options = {}) {
	const ep = eventsPath(username, chatId)
	let out
	try {
		await access(ep)
		out = { groupId: chatId, created: false }
	}
	catch {
		await createGroup(username, {
			groupId: chatId,
			name: options.name || groupDefaultString('dmChatName'),
			desc: options.desc,
			defaultChannelName: options.defaultChannelName || groupDefaultString('defaultChannelName'),
			ownerPubKeyHash: options.ownerPubKeyHash,
		})
		out = { groupId: chatId, created: true }
	}
	if (getFederationConfig(username).enabled)
		void ensureFederationRoom(username, chatId).catch(e => console.error(e))
	return out
}

/**
 * 删除群目录（与 deleteChat 配套）
 * @param {string} username
 * @param {string} groupId
 */
export async function deleteGroupData(username, groupId) {
	try {
		await rm(groupDir(username, groupId), { recursive: true, force: true })
	}
	catch { /* ignore */ }
}

/**
 * @param {string} username
 * @param {string} groupId
 */
export async function getGroupState(username, groupId) {
	const events = await readJsonl(eventsPath(username, groupId))
	let state = emptyMaterializedState()
	const order = topologicalCanonicalOrder(events.map(e => ({
		id: e.id,
		prev_event_id: e.prev_event_id,
		hlc: e.hlc,
		node_id: e.node_id,
		sender: e.sender,
	})))
	const byId = new Map(events.map(e => [e.id, e]))
	for (const id of order) {
		const ev = byId.get(id)
		if (ev) state = foldAuthzEvent(state, ev)
	}
	let checkpoint = null
	try {
		checkpoint = JSON.parse(await readFile(checkpointPath(username, groupId), 'utf8'))
	}
	catch { /* */ }
	return { events, state, order, checkpoint }
}

/**
 * 从 DAG 事件重放当前各频道置顶目标（messageOverlay.pins）
 * @param {object[]} events
 * @returns {Record<string, string[]>}
 */
function foldPinOverlayFromEvents(events) {
	const byCh = new Map()
	for (const ev of events) {
		const ch = ev.channelId || ev.content?.channelId || 'default'
		if (!byCh.has(ch))
			byCh.set(ch, new Set())
		const s = byCh.get(ch)
		if (ev.type === 'pin_message' && ev.content?.targetId)
			s.add(String(ev.content.targetId))
		if (ev.type === 'unpin_message' && ev.content?.targetId)
			s.delete(String(ev.content.targetId))
	}
	/** @type {Record<string, string[]>} */
	const pins = {}
	for (const [ch, s] of byCh)
		if (s.size)
			pins[ch] = [...s]
	return pins
}

/**
 * 重放 DAG 授权类事件并写回 checkpoint.json（单节点 home 简化版）
 * @param {string} username
 * @param {string} groupId
 */
export async function rebuildAndSaveCheckpoint(username, groupId) {
	const { events, state, order } = await getGroupState(username, groupId)
	if (!events.length) return null
	const last = events[events.length - 1]

	let prevCp = null
	try {
		prevCp = JSON.parse(await readFile(checkpointPath(username, groupId), 'utf8'))
	}
	catch { /* no checkpoint yet */ }

	const prevTip = prevCp?.checkpoint_event_id
	const prevTipIdx = prevTip ? order.indexOf(prevTip) : -1
	const sameTip = prevTip && last.id === prevTip

	let eventIdsInEpoch = order
	if (!sameTip && prevTipIdx >= 0)
		eventIdsInEpoch = order.slice(prevTipIdx + 1)
	if (!eventIdsInEpoch.length)
		eventIdsInEpoch = order

	let epoch_id = 1
	/** @type {object[]} */
	let epoch_chain = []
	if (prevCp && !sameTip) {
		epoch_id = (prevCp.epoch_id ?? 0) + 1
		epoch_chain = Array.isArray(prevCp.epoch_chain) ? [...prevCp.epoch_chain] : []
		if (prevCp.epoch_id != null && prevCp.epoch_root_hash) {
			epoch_chain.push({
				epoch_id: prevCp.epoch_id,
				epoch_root_hash: prevCp.epoch_root_hash,
				checkpoint_event_id: prevCp.checkpoint_event_id,
			})
		}
		if (epoch_chain.length > EPOCH_CHAIN_MAX)
			epoch_chain = epoch_chain.slice(-EPOCH_CHAIN_MAX)
	}
	else if (prevCp && sameTip) {
		epoch_id = prevCp.epoch_id ?? 1
		epoch_chain = Array.isArray(prevCp.epoch_chain) ? [...prevCp.epoch_chain] : []
		if (Array.isArray(prevCp.eventIdsInEpoch) && prevCp.eventIdsInEpoch.length)
			eventIdsInEpoch = prevCp.eventIdsInEpoch
	}

	const home = state.home_node_id || NODE_ID
	const pins = foldPinOverlayFromEvents(events)
	const fileIdx = Object.fromEntries(state.fileIndex ?? new Map())
	const fileFolders = buildFileFoldersSnapshot(state.fileIndex)
	const cp = buildCheckpointPayload({
		home_node_id: home,
		materialized: state,
		epoch_id,
		checkpoint_event_id: last.id,
		eventIdsInEpoch,
		overlay: { deletedIds: [], editHistory: {}, reactionCounts: {}, pins, fileIndex: fileIdx },
		fileFolders,
		epoch_chain,
	})
	await mkdir(groupDir(username, groupId), { recursive: true })
	await writeFile(checkpointPath(username, groupId), JSON.stringify(cp, null, '\t'), 'utf8')
	return cp
}

/**
 * 追加 DAG 事件（验签占位：若带 signature 则校验）
 * @param {string} username
 * @param {string} groupId
 * @param {object} event
 * @param {Uint8Array} [secretKey]
 */
export async function appendGroupEvent(username, groupId, event, secretKey) {
	if (event.type === 'home_transfer') {
		const { state } = await getGroupState(username, groupId)
		const admins = adminPubKeyHashes(state)
		const c = event.content || {}
		if (admins.size > 0) {
			const sigs = c.adminSignatures
			if (!Array.isArray(sigs) || !sigs.length) throw new Error('home_transfer requires adminSignatures')
			const ok = await verifyHomeTransferThreshold({
				proposedHomeNodeId: c.proposedHomeNodeId,
				groupId,
				ballotId: c.ballotId || '',
				adminSignatures: sigs,
			}, admins)
			if (!ok) throw new Error('home_transfer threshold verification failed')
		}
	}
	if (event.type === 'owner_succession_ballot') {
		const { state } = await getGroupState(username, groupId)
		const admins = adminPubKeyHashes(state)
		const c = event.content || {}
		if (admins.size > 0) {
			const sigs = c.adminSignatures
			if (!Array.isArray(sigs) || !sigs.length) throw new Error('owner_succession_ballot requires adminSignatures')
			const ok = await verifyOwnerSuccessionThreshold({
				proposedOwnerPubKeyHash: c.proposedOwnerPubKeyHash,
				groupId,
				ballotId: c.ballotId || '',
				adminSignatures: sigs,
			}, admins)
			if (!ok) throw new Error('owner_succession_ballot verification failed')
		}
	}
	if (event.type === 'member_join') {
		const { state } = await getGroupState(username, groupId)
		const jp = state.groupSettings?.joinPolicy || 'open'
		const c = event.content || {}
		if (jp === 'invite-only' && !c.inviteCode) throw new Error('member_join requires inviteCode')
		if (jp === 'pow') {
			const d = Number(state.groupSettings?.powDifficulty) || 0
			if (d <= 0) throw new Error('pow joinPolicy requires powDifficulty >= 1')
			if (!verifyPowSolution(username, groupId, d, c.powSolution))
				throw new Error('invalid or expired pow solution')
		}
	}
	if (event.type === 'message' && PUB_KEY_HASH_HEX.test(String(event.sender))) {
		const ch = event.channelId || event.content?.channelId || 'default'
		const { state } = await getGroupState(username, groupId)
		const perms = memberChannelPermissions(state, event.sender, ch)
		if (!perms.SEND_MESSAGES) throw new Error('SEND_MESSAGES denied')
	}
	if (event.type === 'file_upload' && PUB_KEY_HASH_HEX.test(String(event.sender))) {
		const { state } = await getGroupState(username, groupId)
		const perms = memberChannelPermissions(state, event.sender, 'default')
		if (!perms.UPLOAD_FILES) throw new Error('UPLOAD_FILES denied')
	}
	const roleMgmtTypes = new Set(['role_create', 'role_update', 'role_delete', 'role_assign', 'role_revoke'])
	if (roleMgmtTypes.has(event.type) && PUB_KEY_HASH_HEX.test(String(event.sender))) {
		const { state } = await getGroupState(username, groupId)
		const perms = memberChannelPermissions(state, event.sender, 'default')
		if (!perms.MANAGE_ROLES) throw new Error('MANAGE_ROLES denied')
	}
	const dir = groupDir(username, groupId)
	await mkdir(dir, { recursive: true })
	const prev = await readJsonl(eventsPath(username, groupId))
	const last = prev[prev.length - 1]
	const hlc = nextHlc(last?.hlc, event.timestamp)
	const base = {
		...event,
		groupId,
		hlc,
		prev_event_id: last?.id ?? null,
		received_at: Date.now(),
		isRemote: !!event.isRemote,
		node_id: event.node_id || NODE_ID,
	}
	const body = unsignedEventFields(base)
	const id = computeEventId(body)
	const signPayload = { ...body, id, signature: '' }
	if (secretKey) {
		const sig = await sign(signPayloadBytes(body), secretKey)
		signPayload.signature = Buffer.from(sig).toString('hex')
		const { getPublicKey } = await import('npm:@noble/ed25519')
		signPayload.senderPubKey = Buffer.from(getPublicKey(secretKey.slice(0, 32))).toString('hex')
	}
	else {
		signPayload.signature = event.signature || ''
		if (event.senderPubKey) signPayload.senderPubKey = event.senderPubKey
	}

	await validateEd25519Signature(username, groupId, body, signPayload, event, secretKey)

	await appendJsonl(eventsPath(username, groupId), signPayload)
	await broadcastAndPersistAfterSignedEvent(username, groupId, signPayload)
	await publishSignedEventToFederation(username, groupId, signPayload)

	return signPayload
}

/**
 * 创建频道（DAG channel_create）
 * @param {string} username
 * @param {string} groupId
 * @param {object} opts
 */
export async function createGroupChannel(username, groupId, opts) {
	const channelId = opts.channelId || randomUUID()
	return appendGroupEvent(username, groupId, {
		type: 'channel_create',
		sender: opts.sender || 'local',
		timestamp: Date.now(),
		content: {
			channelId,
			type: opts.type || 'text',
			name: opts.name || channelId,
			desc: opts.desc,
			parentChannelId: opts.parentChannelId,
			syncScope: opts.syncScope || 'group',
			isPrivate: !!opts.isPrivate,
			subRoomId: opts.subRoomId,
			manualItems: opts.manualItems,
		},
	})
}

/**
 * @param {string} username
 * @param {string} groupId
 * @param {string} channelId
 * @param {object} [patch]
 */
export async function updateGroupChannel(username, groupId, channelId, patch = {}) {
	const { sender: snd = 'local', ...rest } = patch
	return appendGroupEvent(username, groupId, {
		type: 'channel_update',
		sender: snd,
		timestamp: Date.now(),
		content: { channelId, ...rest },
	})
}

/**
 * @param {string} username
 * @param {string} groupId
 * @param {string} channelId
 */
export async function deleteGroupChannel(username, groupId, channelId) {
	return appendGroupEvent(username, groupId, {
		type: 'channel_delete',
		sender: 'local',
		timestamp: Date.now(),
		content: { channelId },
	})
}

/**
 * list 频道条目更新（DAG list_item_update）
 * @param {string} username
 * @param {string} groupId
 * @param {string} channelId
 * @param {Array<{ title?: string, desc?: string, targetChannelId?: string, url?: string }>} items
 * @param {string} [sender]
 */
export async function appendListItemUpdate(username, groupId, channelId, items, sender = 'local') {
	return appendGroupEvent(username, groupId, {
		type: 'list_item_update',
		sender,
		timestamp: Date.now(),
		channelId,
		content: { channelId, items },
	})
}

/**
 * 置顶消息（DAG pin_message，写入频道消息流）
 * @param {string} username
 * @param {string} groupId
 * @param {string} channelId
 * @param {string} targetEventId 被置顶的 DAG 事件 id
 * @param {string} [sender]
 */
export async function appendPinMessageEvent(username, groupId, channelId, targetEventId, sender = 'local') {
	return appendGroupEvent(username, groupId, {
		type: 'pin_message',
		channelId,
		sender,
		timestamp: Date.now(),
		content: { channelId, targetId: targetEventId },
	})
}

/**
 * 取消置顶（DAG unpin_message）
 * @param {string} username
 * @param {string} groupId
 * @param {string} channelId
 * @param {string} targetEventId
 * @param {string} [sender]
 */
export async function appendUnpinMessageEvent(username, groupId, channelId, targetEventId, sender = 'local') {
	return appendGroupEvent(username, groupId, {
		type: 'unpin_message',
		channelId,
		sender,
		timestamp: Date.now(),
		content: { channelId, targetId: targetEventId },
	})
}

/**
 * 私密频道密钥分发（E2E 密文；超级节点不解析）
 * @param {string} username
 * @param {string} groupId
 * @param {{ channelId: string, epoch: number, ciphertexts?: object[], sender?: string }} body
 */
export async function appendEncryptedMailboxBatch(username, groupId, body) {
	const { channelId, epoch, ciphertexts = [], sender = 'local' } = body
	if (!channelId) throw new Error('channelId required')
	const { state } = await getGroupState(username, groupId)
	const chMeta = state.channels.get(channelId)
	if (chMeta?.isPrivate && state.members.size > 200)
		throw Object.assign(new Error('私密频道成员超过 200 人上限，请启用 MLS 插件（路线图 P1）或减少成员'), { code: 'MLS_REQUIRED', memberCount: state.members.size })
	const lastAt = state.privateMailboxLastPostAt?.get(channelId) || 0
	if (Date.now() - lastAt < 500) throw new Error('mailbox rate limited')
	return appendGroupEvent(username, groupId, {
		type: 'encrypted_mailbox_batch',
		channelId,
		sender,
		timestamp: Date.now(),
		content: { channelId, epoch, ciphertexts },
	})
}

/**
 * 群主/代理活跃心跳（供 succession ballot 等消费）
 * @param {string} username
 * @param {string} groupId
 * @param {{ ownerPubKeyHash: string, sender?: string }} body
 */
export async function appendOwnerHeartbeat(username, groupId, body) {
	const { ownerPubKeyHash, sender = 'local' } = body
	if (!ownerPubKeyHash) throw new Error('ownerPubKeyHash required')
	return appendGroupEvent(username, groupId, {
		type: 'owner_heartbeat',
		sender,
		timestamp: Date.now(),
		content: { ownerPubKeyHash },
	})
}

/**
 * 代理执行官 succession ballot（>50% 管理员 Ed25519 联署 proposedOwnerPubKeyHash）
 * @param {string} username
 * @param {string} groupId
 * @param {{ proposedOwnerPubKeyHash: string, ballotId: string, adminSignatures: object[], sender?: string }} body
 */
export async function appendOwnerSuccessionBallot(username, groupId, body) {
	const { proposedOwnerPubKeyHash, ballotId, adminSignatures, sender = 'local' } = body
	if (!proposedOwnerPubKeyHash || !ballotId) throw new Error('proposedOwnerPubKeyHash and ballotId required')
	return appendGroupEvent(username, groupId, {
		type: 'owner_succession_ballot',
		sender,
		timestamp: Date.now(),
		content: { proposedOwnerPubKeyHash, ballotId, adminSignatures },
	})
}

/**
 * 群文件元数据入 DAG（不含 aesKey；密钥由 home 经认证信道写入 Checkpoint）
 * @param {string} username
 * @param {string} groupId
 * @param {object} meta
 */
export async function appendFileUploadEvent(username, groupId, meta) {
	const fileId = meta.fileId || randomUUID()
	return appendGroupEvent(username, groupId, {
		type: 'file_upload',
		sender: meta.sender || 'local',
		timestamp: Date.now(),
		content: {
			fileId,
			name: meta.name,
			size: meta.size,
			mimeType: meta.mimeType,
			folderId: meta.folderId,
			chunkManifest: meta.chunkManifest || [],
		},
	})
}

/**
 * @param {string} username
 * @param {string} groupId
 * @param {string} fileId
 * @param {string} [sender]
 */
export async function appendFileDeleteEvent(username, groupId, fileId, sender = 'local') {
	// 吊销 aesKey
	await deleteFileAesKey(username, groupId, fileId)
	return appendGroupEvent(username, groupId, {
		type: 'file_delete',
		sender,
		timestamp: Date.now(),
		content: { fileId },
	})
}

// ─── 文件 aesKey 安全存储（与 DAG 解耦，仅服务端持有）─────────────────────

function aesKeysPath(username, groupId) {
	return join(getUserDictionary(username), 'shells', 'chat', 'groups', groupId, 'aes_keys.json')
}

/**
 * 存储 fileId → aesKeyHex（仅 home 节点调用，不写入 DAG）
 * @param {string} username
 * @param {string} groupId
 * @param {string} fileId
 * @param {string} aesKeyHex 256-bit AES key in hex
 */
export async function storeFileAesKey(username, groupId, fileId, aesKeyHex) {
	const p = aesKeysPath(username, groupId)
	await mkdir(join(p, '..'), { recursive: true })
	let obj = {}
	try { obj = JSON.parse(await readFile(p, 'utf8')) } catch { /* new */ }
	obj[String(fileId)] = String(aesKeyHex)
	await writeFile(p, JSON.stringify(obj, null, '\t'), 'utf8')
}

/**
 * 读取 fileId 对应的 aesKeyHex
 * @param {string} username
 * @param {string} groupId
 * @param {string} fileId
 * @returns {Promise<string | null>}
 */
export async function getFileAesKey(username, groupId, fileId) {
	try {
		const obj = JSON.parse(await readFile(aesKeysPath(username, groupId), 'utf8'))
		return typeof obj[fileId] === 'string' ? obj[fileId] : null
	}
	catch { return null }
}

/**
 * 吊销 aesKey（file_delete 时调用）
 * @param {string} username
 * @param {string} groupId
 * @param {string} fileId
 */
async function deleteFileAesKey(username, groupId, fileId) {
	try {
		const p = aesKeysPath(username, groupId)
		const obj = JSON.parse(await readFile(p, 'utf8'))
		delete obj[fileId]
		await writeFile(p, JSON.stringify(obj, null, '\t'), 'utf8')
	}
	catch { /* ignore */ }
}

// ─── reaction 事件 ──────────────────────────────────────────────────────────

/**
 * reaction_add / reaction_remove DAG 事件。
 * @param {string} username
 * @param {string} groupId
 * @param {{ type: 'reaction_add'|'reaction_remove', channelId: string, targetEventId: string, emoji: string, sender?: string, targetPubKeyHash?: string }} opts
 */
export async function appendReactionEvent(username, groupId, opts) {
	const { type, channelId = 'default', targetEventId, emoji, sender = 'local', targetPubKeyHash } = opts
	if (!targetEventId || !emoji) throw new Error('targetEventId and emoji required')
	const content = { targetId: targetEventId, emoji }
	if (type === 'reaction_remove' && targetPubKeyHash)
		content.targetPubKeyHash = targetPubKeyHash
	return appendGroupEvent(username, groupId, {
		type,
		channelId,
		sender,
		timestamp: Date.now(),
		content,
	})
}

// ─── AI 定频自动触发 ────────────────────────────────────────────────────────

/** groupId → { lastTriggeredAt: number, msgCount: number } */
const groupAutoFreqState = new Map()

/**
 * 在每条消息入库后调用：若群配置了 autoReplyFrequency，则按频率触发 AI 回复。
 * @param {string} username
 * @param {string} groupId
 * @param {string} channelId
 */
export async function maybeAutoTriggerCharReply(username, groupId, channelId) {
	try {
		const { state } = await getGroupState(username, groupId)
		const freq = Number(state.groupSettings?.autoReplyFrequency) || 0
		if (freq <= 0) return
		const key = `${groupId}\0${channelId}`
		let s = groupAutoFreqState.get(key)
		if (!s) { s = { lastTriggeredAt: 0, msgCount: 0 }; groupAutoFreqState.set(key, s) }
		s.msgCount++
		if (s.msgCount < freq) return
		s.msgCount = 0
		s.lastTriggeredAt = Date.now()
		// 通过 WS 广播 ai_auto_trigger 消息，让前端调用生成（与 @mention 走相同路径）
		broadcastGroupEvent(groupId, { type: 'ai_auto_trigger', channelId, groupId })
	}
	catch { /* ignore */ }
}

/**
 * @param {string} username
 * @param {string} groupId
 * @param {{ since?: string, limit?: number }} q
 */
export async function syncGroupEvents(username, groupId, q) {
	const events = await readJsonl(eventsPath(username, groupId))
	const limit = Math.min(Number(q.limit) || DEFAULT_MAX_CATCHUP_EVENTS, DEFAULT_MAX_CATCHUP_EVENTS)
	if (!q.since) {
		const slice = events.slice(-limit)
		return { events: slice, truncated: events.length > limit }
	}
	const idx = events.findIndex(e => e.id === q.since)
	const slice = idx === -1 ? events : events.slice(idx + 1)
	return { events: slice.slice(0, limit), truncated: slice.length > limit }
}

/**
 * @param {string} username
 * @param {string} groupId
 * @param {string} channelId
 * @param {{ before?: string, limit?: number }} q
 */
export async function listChannelMessages(username, groupId, channelId, q) {
	const lines = await readJsonl(messagesPath(username, groupId, channelId))
	const limit = Math.min(Number(q.limit) || 200, 500)
	if (!q.before) return lines.slice(-limit)
	const idx = lines.findIndex(l => l.eventId === q.before)
	if (idx <= 0) return []
	return lines.slice(Math.max(0, idx - limit), idx)
}

/**
 * 列出会话 id：传统 `chats/*.json` 与 `groups/*` 并集（迁移期兼容；最终一一对应）
 * @param {string} username
 * @returns {Promise<string[]>}
 */
export async function listUserGroups(username) {
	const root = join(getUserDictionary(username), 'shells', 'chat')
	const ids = new Set()
	try {
		const base = join(root, 'groups')
		const ents = await readdir(base, { withFileTypes: true })
		for (const d of ents)
			if (d.isDirectory()) ids.add(d.name)
	}
	catch { /* ignore */ }
	try {
		const chatsDir = join(root, 'chats')
		for (const f of await readdir(chatsDir))
			if (f.endsWith('.json')) ids.add(f.replace(/\.json$/u, ''))
	}
	catch { /* ignore */ }
	return [...ids]
}

/**
 * 返回群组列表及名称（从 checkpoint.json 快读，避免全量重放）
 * @param {string} username
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function listUserGroupsWithMeta(username) {
	const ids = await listUserGroups(username)
	return Promise.all(ids.map(async id => {
		let name = id
		try {
			const cp = JSON.parse(await readFile(checkpointPath(username, id), 'utf8'))
			if (cp?.groupMeta?.name) name = cp.groupMeta.name
		}
		catch { /* checkpoint 不存在或无法解析，回退到 id */ }
		return { id, name }
	}))
}

export function getNodeId() {
	return NODE_ID
}

/**
 * @param {string} username
 */
export function getGroupStorage(username) {
	return createLocalStoragePlugin(join(getUserDictionary(username), 'shells', 'chat'))
}

/**
 * 权限查询（物化重放）
 * @param {string} username
 * @param {string} groupId
 * @param {string} pubKeyHash
 * @param {string} channelId
 */
export async function getEffectivePermissions(username, groupId, pubKeyHash, channelId) {
	const { state } = await getGroupState(username, groupId)
	return memberChannelPermissions(state, pubKeyHash, channelId)
}
