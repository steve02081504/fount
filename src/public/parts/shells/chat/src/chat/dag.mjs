import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { access, mkdir, appendFile, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { getUserDictionary } from '../../../../../../server/auth.mjs'
import { loadShellData } from '../../../../../../server/setting_loader.mjs'
import { geti18n } from '../../../../../../scripts/i18n.mjs'
import {
	computeEventId,
	signPayloadBytes,
	topologicalCanonicalOrder,
} from '../../../../../../scripts/p2p/dag.mjs'
import { pubKeyHash, sign, verify } from '../../../../../../scripts/p2p/crypto.mjs'
import { nextHlc } from '../../../../../../scripts/p2p/hlc.mjs'
import {
	adminPubKeyHashes,
	emptyMaterializedState,
	foldAuthzEvent,
	memberChannelPermissions,
} from '../../../../../../scripts/p2p/materialized_state.mjs'
import { verifyHomeTransferThreshold, verifyOwnerSuccessionThreshold } from '../../../../../../scripts/p2p/home_transfer_ballot.mjs'
import { buildCheckpointPayload, buildFileFoldersSnapshot } from '../../../../../../scripts/p2p/checkpoint.mjs'
import { DEFAULT_MAX_CATCHUP_EVENTS, EPOCH_CHAIN_MAX } from '../../../../../../scripts/p2p/constants.mjs'

import { broadcastEvent } from './websocket.mjs'
import { deleteFileAesKey } from './storage.mjs'
import { verifyPowSolution } from './websocket.mjs'

export const NODE_ID = randomUUID()

// ─── 路径辅助 ────────────────────────────────────────────────────────────────

function chatDir(username, chatId) {
	return join(getUserDictionary(username), 'shells', 'chat', 'groups', chatId)
}

function eventsPath(username, chatId) {
	return join(chatDir(username, chatId), 'events.jsonl')
}

function checkpointPath(username, chatId) {
	return join(chatDir(username, chatId), 'checkpoint.json')
}

function messagesPath(username, chatId, channelId) {
	return join(chatDir(username, chatId), 'messages', `${channelId}.jsonl`)
}

// ─── JSONL 工具 ──────────────────────────────────────────────────────────────

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

// ─── 联邦（Trystero MQTT）────────────────────────────────────────────────────

/**
 * 联邦配置：`loadShellData(username, 'chat', 'federation')`
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

function federationRoomKey(username, chatId) {
	return `${username}\0${chatId}`
}

/**
 * 加入 `fount-fed-${chatId}` MQTT 房间并订阅 `dag_event`；失败返回 null。
 * @param {string} username
 * @param {string} chatId
 */
async function ensureFederationRoom(username, chatId) {
	const { enabled, appId, password } = getFederationConfig(username)
	if (!enabled || !password) return null
	const key = federationRoomKey(username, chatId)
	if (federationRooms.has(key)) return federationRooms.get(key)
	if (federationRoomInflight.has(key)) return await federationRoomInflight.get(key)

	const p = (async () => {
		try {
			const { joinMqttRoom } = await import('../../../../../../scripts/p2p/federation_trystero.mjs')
			const { RTCPeerConnection } = await import('npm:node-datachannel/polyfill')
			const room = await joinMqttRoom({
				appId,
				rtcPolyfill: RTCPeerConnection,
				password,
			}, `fount-fed-${chatId}`)
			const [sendDag, getDag] = room.makeAction('dag_event')
			getDag((data, _peerId) => {
				void ingestRemoteEvent(username, chatId, data).catch(e => console.error(e))
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
 * 本地写入成功后向联邦广播已签名事件。
 * @param {string} username
 * @param {string} chatId
 * @param {object} signPayload
 */
async function publishEventToFederation(username, chatId, signPayload) {
	const slot = await ensureFederationRoom(username, chatId)
	if (!slot?.sendDag) return
	try {
		slot.sendDag(signPayload, null)
	}
	catch (e) {
		console.error('federation: publish failed', e)
	}
}

/**
 * 校验并入库远程 DAG 事件（不再次向联邦广播，避免回环）。
 * @param {string} username
 * @param {string} chatId
 * @param {unknown} payload Trystero 收到的对象或 { event }
 */
async function ingestRemoteEvent(username, chatId, payload) {
	let signPayload = payload
	if (payload && typeof payload === 'object' && 'event' in /** @type {object} */ (payload)
		&& typeof /** @type {{ event?: object }} */ (payload).event === 'object'
		&& /** @type {{ event?: object }} */ (payload).event)
		signPayload = /** @type {{ event: object }} */ (payload).event
	if (!signPayload || typeof signPayload !== 'object') return
	const sp = /** @type {Record<string, unknown>} */ (signPayload)
	if (!sp.id || typeof sp.id !== 'string') return

	const path = eventsPath(username, chatId)
	const prev = await readJsonl(path)
	if (prev.some(e => e.id === sp.id)) return

	const bodyForId = unsignedEventFields(/** @type {object} */ (signPayload))
	if (computeEventId(bodyForId) !== sp.id) {
		console.error('federation: drop remote event (id mismatch)')
		return
	}

	try {
		await validateSignature(username, chatId, bodyForId, /** @type {any} */ (signPayload), /** @type {any} */ (signPayload), undefined)
	}
	catch (e) {
		console.error('federation: drop remote event (signature)', e)
		return
	}

	await appendJsonl(path, signPayload)
	await broadcastAndPersist(username, chatId, /** @type {object} */ (signPayload))
}

// ─── 写入频道消息流的事件类型 ─────────────────────────────────────────────────

const PERSIST_MESSAGE_TYPES = new Set([
	'message', 'message_edit', 'message_delete', 'message_feedback',
	'vote_cast', 'pin_message', 'unpin_message',
	'reaction_add', 'reaction_remove',
])

/**
 * DAG 事件已写入 events.jsonl 后：WS 广播、频道消息行、checkpoint。
 * @param {string} username
 * @param {string} chatId
 * @param {object} signPayload
 */
async function broadcastAndPersist(username, chatId, signPayload) {
	broadcastEvent(chatId, { type: 'dag_event', event: signPayload })
	if (!PERSIST_MESSAGE_TYPES.has(signPayload.type)) {
		await rebuildAndSaveCheckpoint(username, chatId)
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
	const mp = messagesPath(username, chatId, ch)
	await mkdir(join(mp, '..'), { recursive: true })
	await appendFile(mp, `${JSON.stringify(msgLine)}\n`, 'utf8')
	broadcastEvent(chatId, { type: 'channel_message', channelId: ch, message: msgLine })
	await rebuildAndSaveCheckpoint(username, chatId)
	if (signPayload.type === 'message')
		void maybeAutoTriggerCharReply(username, chatId, ch).catch(() => {})
}

// ─── 签名验证 ────────────────────────────────────────────────────────────────

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
 * @param {string} chatId
 * @param {object} body unsignedEventFields(base)
 * @param {{ id: string, signature?: string, senderPubKey?: string }} signPayload
 * @param {{ senderPubKey?: string }} eventLike
 * @param {Uint8Array} [secretKey]
 */
async function validateSignature(username, chatId, body, signPayload, eventLike, secretKey) {
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
			const { state } = await getState(username, chatId)
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

// ─── 群组 CRUD ────────────────────────────────────────────────────────────────

/**
 * @param {string} username
 * @param {object} body
 */
export async function createGroup(username, body) {
	const chatId = body.groupId || randomUUID()
	const dir = chatDir(username, chatId)
	await mkdir(dir, { recursive: true })
	const genesisBase = {
		type: 'group_meta_update',
		groupId: chatId,
		sender: body.ownerPubKeyHash || 'local',
		timestamp: Date.now(),
		hlc: { wall: Date.now(), logical: 0 },
		prev_event_id: null,
		content: { name: body.name || geti18n('chat.group.defaults.groupMetaName'), desc: body.desc || '' },
		node_id: NODE_ID,
	}
	const id = computeEventId(unsignedEventFields(genesisBase))
	const signPayload = { ...unsignedEventFields(genesisBase), id, signature: '' }
	await mkdir(chatDir(username, chatId), { recursive: true })
	await writeFile(eventsPath(username, chatId), `${JSON.stringify(signPayload)}\n`, 'utf8')

	const initialChannelId = body.defaultChannelId || 'default'
	await appendEvent(username, chatId, {
		type: 'channel_create',
		sender: 'local',
		timestamp: Date.now(),
		content: {
			channelId: initialChannelId,
			type: body.defaultChannelType || 'text',
			name: body.defaultChannelName || geti18n('chat.group.defaults.defaultChannelName'),
			syncScope: 'group',
		},
	})

	await appendEvent(username, chatId, {
		type: 'group_settings_update',
		sender: 'local',
		timestamp: Date.now(),
		content: { defaultChannelId: initialChannelId },
	})

	const s = await getState(username, chatId)
	return { groupId: chatId, checkpoint: s.checkpoint }
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
export async function ensureChat(username, chatId, options = {}) {
	const ep = eventsPath(username, chatId)
	let out
	try {
		await access(ep)
		out = { groupId: chatId, created: false }
	}
	catch {
		await createGroup(username, {
			groupId: chatId,
			name: options.name || geti18n('chat.group.defaults.dmChatName'),
			desc: options.desc,
			defaultChannelName: options.defaultChannelName || geti18n('chat.group.defaults.defaultChannelName'),
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
 * @param {string} chatId
 */
export async function deleteChatData(username, chatId) {
	try {
		await rm(chatDir(username, chatId), { recursive: true, force: true })
	}
	catch { /* ignore */ }
}

// ─── 状态查询 ────────────────────────────────────────────────────────────────

/**
 * @param {string} username
 * @param {string} chatId
 */
export async function getState(username, chatId) {
	const events = await readJsonl(eventsPath(username, chatId))
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
		checkpoint = JSON.parse(await readFile(checkpointPath(username, chatId), 'utf8'))
	}
	catch { /* */ }
	return { events, state, order, checkpoint }
}

/**
 * 从 DAG 事件重放各频道置顶目标（messageOverlay.pins）
 * @param {object[]} events
 * @returns {Record<string, string[]>}
 */
function foldPinOverlay(events) {
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
 * 重放 DAG 授权类事件并写回 checkpoint.json
 * @param {string} username
 * @param {string} chatId
 */
export async function rebuildAndSaveCheckpoint(username, chatId) {
	const { events, state, order } = await getState(username, chatId)
	if (!events.length) return null
	const last = events[events.length - 1]

	let prevCp = null
	try {
		prevCp = JSON.parse(await readFile(checkpointPath(username, chatId), 'utf8'))
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
	const pins = foldPinOverlay(events)
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
	await mkdir(chatDir(username, chatId), { recursive: true })
	await writeFile(checkpointPath(username, chatId), JSON.stringify(cp, null, '\t'), 'utf8')
	return cp
}

// ─── DAG 事件追加 ─────────────────────────────────────────────────────────────

/**
 * 追加 DAG 事件（验签占位：若带 signature 则校验）
 * @param {string} username
 * @param {string} chatId
 * @param {object} event
 * @param {Uint8Array} [secretKey]
 */
export async function appendEvent(username, chatId, event, secretKey) {
	if (event.type === 'home_transfer') {
		const { state } = await getState(username, chatId)
		const admins = adminPubKeyHashes(state)
		const c = event.content || {}
		if (admins.size > 0) {
			const sigs = c.adminSignatures
			if (!Array.isArray(sigs) || !sigs.length) throw new Error('home_transfer requires adminSignatures')
			const ok = await verifyHomeTransferThreshold({
				proposedHomeNodeId: c.proposedHomeNodeId,
				groupId: chatId,
				ballotId: c.ballotId || '',
				adminSignatures: sigs,
			}, admins)
			if (!ok) throw new Error('home_transfer threshold verification failed')
		}
	}
	if (event.type === 'owner_succession_ballot') {
		const { state } = await getState(username, chatId)
		const admins = adminPubKeyHashes(state)
		const c = event.content || {}
		if (admins.size > 0) {
			const sigs = c.adminSignatures
			if (!Array.isArray(sigs) || !sigs.length) throw new Error('owner_succession_ballot requires adminSignatures')
			const ok = await verifyOwnerSuccessionThreshold({
				proposedOwnerPubKeyHash: c.proposedOwnerPubKeyHash,
				groupId: chatId,
				ballotId: c.ballotId || '',
				adminSignatures: sigs,
			}, admins)
			if (!ok) throw new Error('owner_succession_ballot verification failed')
		}
	}
	if (event.type === 'member_join') {
		const { state } = await getState(username, chatId)
		const jp = state.groupSettings?.joinPolicy || 'open'
		const c = event.content || {}
		if (jp === 'invite-only' && !c.inviteCode) throw new Error('member_join requires inviteCode')
		if (jp === 'pow') {
			const d = Number(state.groupSettings?.powDifficulty) || 0
			if (d <= 0) throw new Error('pow joinPolicy requires powDifficulty >= 1')
			if (!verifyPowSolution(username, chatId, d, c.powSolution))
				throw new Error('invalid or expired pow solution')
		}
	}
	if (event.type === 'message' && PUB_KEY_HASH_HEX.test(String(event.sender))) {
		const ch = event.channelId || event.content?.channelId || 'default'
		const { state } = await getState(username, chatId)
		const perms = memberChannelPermissions(state, event.sender, ch)
		if (!perms.SEND_MESSAGES) throw new Error('SEND_MESSAGES denied')
	}
	if (event.type === 'file_upload' && PUB_KEY_HASH_HEX.test(String(event.sender))) {
		const { state } = await getState(username, chatId)
		const perms = memberChannelPermissions(state, event.sender, 'default')
		if (!perms.UPLOAD_FILES) throw new Error('UPLOAD_FILES denied')
	}
	const roleMgmtTypes = new Set(['role_create', 'role_update', 'role_delete', 'role_assign', 'role_revoke'])
	if (roleMgmtTypes.has(event.type) && PUB_KEY_HASH_HEX.test(String(event.sender))) {
		const { state } = await getState(username, chatId)
		const perms = memberChannelPermissions(state, event.sender, 'default')
		if (!perms.MANAGE_ROLES) throw new Error('MANAGE_ROLES denied')
	}
	const dir = chatDir(username, chatId)
	await mkdir(dir, { recursive: true })
	const prev = await readJsonl(eventsPath(username, chatId))
	const last = prev[prev.length - 1]
	const hlc = nextHlc(last?.hlc, event.timestamp)
	const base = {
		...event,
		groupId: chatId,
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

	await validateSignature(username, chatId, body, signPayload, event, secretKey)

	await appendJsonl(eventsPath(username, chatId), signPayload)
	await broadcastAndPersist(username, chatId, signPayload)
	await publishEventToFederation(username, chatId, signPayload)

	return signPayload
}

// ─── 频道管理 ─────────────────────────────────────────────────────────────────

/**
 * @param {string} username
 * @param {string} chatId
 * @param {object} opts
 */
export async function createChannel(username, chatId, opts) {
	const channelId = opts.channelId || randomUUID()
	return appendEvent(username, chatId, {
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
 * @param {string} chatId
 * @param {string} channelId
 * @param {object} [patch]
 */
export async function updateChannel(username, chatId, channelId, patch = {}) {
	const { sender: snd = 'local', ...rest } = patch
	return appendEvent(username, chatId, {
		type: 'channel_update',
		sender: snd,
		timestamp: Date.now(),
		content: { channelId, ...rest },
	})
}

/**
 * @param {string} username
 * @param {string} chatId
 * @param {string} channelId
 */
export async function deleteChannel(username, chatId, channelId) {
	return appendEvent(username, chatId, {
		type: 'channel_delete',
		sender: 'local',
		timestamp: Date.now(),
		content: { channelId },
	})
}

/**
 * list 频道条目更新（DAG list_item_update）
 * @param {string} username
 * @param {string} chatId
 * @param {string} channelId
 * @param {Array<{ title?: string, desc?: string, targetChannelId?: string, url?: string }>} items
 * @param {string} [sender]
 */
export async function appendListItemUpdate(username, chatId, channelId, items, sender = 'local') {
	return appendEvent(username, chatId, {
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
 * @param {string} chatId
 * @param {string} channelId
 * @param {string} targetEventId
 * @param {string} [sender]
 */
export async function appendPinEvent(username, chatId, channelId, targetEventId, sender = 'local') {
	return appendEvent(username, chatId, {
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
 * @param {string} chatId
 * @param {string} channelId
 * @param {string} targetEventId
 * @param {string} [sender]
 */
export async function appendUnpinEvent(username, chatId, channelId, targetEventId, sender = 'local') {
	return appendEvent(username, chatId, {
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
 * @param {string} chatId
 * @param {{ channelId: string, epoch: number, ciphertexts?: object[], sender?: string }} body
 */
export async function appendEncryptedMailboxBatch(username, chatId, body) {
	const { channelId, epoch, ciphertexts = [], sender = 'local' } = body
	if (!channelId) throw new Error('channelId required')
	const { state } = await getState(username, chatId)
	const chMeta = state.channels.get(channelId)
	if (chMeta?.isPrivate && state.members.size > 200)
		throw Object.assign(new Error('私密频道成员超过 200 人上限，请启用 MLS 插件（路线图 P1）或减少成员'), { code: 'MLS_REQUIRED', memberCount: state.members.size })
	const lastAt = state.privateMailboxLastPostAt?.get(channelId) || 0
	if (Date.now() - lastAt < 500) throw new Error('mailbox rate limited')
	return appendEvent(username, chatId, {
		type: 'encrypted_mailbox_batch',
		channelId,
		sender,
		timestamp: Date.now(),
		content: { channelId, epoch, ciphertexts },
	})
}

/**
 * 群主/代理活跃心跳
 * @param {string} username
 * @param {string} chatId
 * @param {{ ownerPubKeyHash: string, sender?: string }} body
 */
export async function appendOwnerHeartbeat(username, chatId, body) {
	const { ownerPubKeyHash, sender = 'local' } = body
	if (!ownerPubKeyHash) throw new Error('ownerPubKeyHash required')
	return appendEvent(username, chatId, {
		type: 'owner_heartbeat',
		sender,
		timestamp: Date.now(),
		content: { ownerPubKeyHash },
	})
}

/**
 * 代理执行官 succession ballot（>50% 管理员 Ed25519 联署 proposedOwnerPubKeyHash）
 * @param {string} username
 * @param {string} chatId
 * @param {{ proposedOwnerPubKeyHash: string, ballotId: string, adminSignatures: object[], sender?: string }} body
 */
export async function appendOwnerSuccessionBallot(username, chatId, body) {
	const { proposedOwnerPubKeyHash, ballotId, adminSignatures, sender = 'local' } = body
	if (!proposedOwnerPubKeyHash || !ballotId) throw new Error('proposedOwnerPubKeyHash and ballotId required')
	return appendEvent(username, chatId, {
		type: 'owner_succession_ballot',
		sender,
		timestamp: Date.now(),
		content: { proposedOwnerPubKeyHash, ballotId, adminSignatures },
	})
}

/**
 * 群文件元数据入 DAG（不含 aesKey；密钥由 home 经认证信道写入 Checkpoint）
 * @param {string} username
 * @param {string} chatId
 * @param {object} meta
 */
export async function appendFileUploadEvent(username, chatId, meta) {
	const fileId = meta.fileId || randomUUID()
	return appendEvent(username, chatId, {
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
 * @param {string} chatId
 * @param {string} fileId
 * @param {string} [sender]
 */
export async function appendFileDeleteEvent(username, chatId, fileId, sender = 'local') {
	await deleteFileAesKey(username, chatId, fileId)
	return appendEvent(username, chatId, {
		type: 'file_delete',
		sender,
		timestamp: Date.now(),
		content: { fileId },
	})
}

/**
 * reaction_add / reaction_remove DAG 事件。
 * @param {string} username
 * @param {string} chatId
 * @param {{ type: 'reaction_add'|'reaction_remove', channelId: string, targetEventId: string, emoji: string, sender?: string, targetPubKeyHash?: string }} opts
 */
export async function appendReactionEvent(username, chatId, opts) {
	const { type, channelId = 'default', targetEventId, emoji, sender = 'local', targetPubKeyHash } = opts
	if (!targetEventId || !emoji) throw new Error('targetEventId and emoji required')
	const content = { targetId: targetEventId, emoji }
	if (type === 'reaction_remove' && targetPubKeyHash)
		content.targetPubKeyHash = targetPubKeyHash
	return appendEvent(username, chatId, {
		type,
		channelId,
		sender,
		timestamp: Date.now(),
		content,
	})
}

// ─── AI 定频自动触发 ──────────────────────────────────────────────────────────

/** chatId → { lastTriggeredAt: number, msgCount: number } */
const autoFreqState = new Map()

/**
 * 在每条消息入库后调用：若配置了 autoReplyFrequency，则按频率触发 AI 回复。
 * @param {string} username
 * @param {string} chatId
 * @param {string} channelId
 */
export async function maybeAutoTriggerCharReply(username, chatId, channelId) {
	try {
		const { state } = await getState(username, chatId)
		const freq = Number(state.groupSettings?.autoReplyFrequency) || 0
		if (freq <= 0) return
		const key = `${chatId}\0${channelId}`
		let s = autoFreqState.get(key)
		if (!s) { s = { lastTriggeredAt: 0, msgCount: 0 }; autoFreqState.set(key, s) }
		s.msgCount++
		if (s.msgCount < freq) return
		s.msgCount = 0
		s.lastTriggeredAt = Date.now()
		broadcastEvent(chatId, { type: 'ai_auto_trigger', channelId, groupId: chatId })
	}
	catch { /* ignore */ }
}

// ─── 同步 / 查询 ──────────────────────────────────────────────────────────────

/**
 * @param {string} username
 * @param {string} chatId
 * @param {{ since?: string, limit?: number }} q
 */
export async function syncEvents(username, chatId, q) {
	const events = await readJsonl(eventsPath(username, chatId))
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
 * @param {string} chatId
 * @param {string} channelId
 * @param {{ before?: string, limit?: number }} q
 */
export async function listChannelMessages(username, chatId, channelId, q) {
	const lines = await readJsonl(messagesPath(username, chatId, channelId))
	const limit = Math.min(Number(q.limit) || 200, 500)
	if (!q.before) return lines.slice(-limit)
	const idx = lines.findIndex(l => l.eventId === q.before)
	if (idx <= 0) return []
	return lines.slice(Math.max(0, idx - limit), idx)
}

/**
 * 列出会话 id
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
 * 返回群组列表及名称（从 checkpoint.json 快读）
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
 * 获取群组的默认频道 ID（优先 groupSettings.defaultChannelId，否则取第一个频道或 'default'）
 * @param {string} username
 * @param {string} chatId
 * @returns {Promise<string>}
 */
export async function getDefaultChannelId(username, chatId) {
	try {
		const { state } = await getState(username, chatId)
		if (state.groupSettings?.defaultChannelId)
			return String(state.groupSettings.defaultChannelId)
		const firstChannel = state.channels.keys().next().value
		return firstChannel || 'default'
	}
	catch {
		return 'default'
	}
}

/**
 * 权限查询（物化重放）
 * @param {string} username
 * @param {string} chatId
 * @param {string} pubKeyHash
 * @param {string} channelId
 */
export async function getEffectivePermissions(username, chatId, pubKeyHash, channelId) {
	const { state } = await getState(username, chatId)
	return memberChannelPermissions(state, pubKeyHash, channelId)
}
