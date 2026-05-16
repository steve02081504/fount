import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { geti18n } from '../../../../../../scripts/i18n.mjs'
import { buildCheckpointPayload, signCheckpoint } from '../../../../../../scripts/p2p/checkpoint.mjs'
import { DEFAULT_LOGICAL_STREAM_IDLE_MS, DEFAULT_MAX_CATCHUP_EVENTS, EPOCH_CHAIN_MAX } from '../../../../../../scripts/p2p/constants.mjs'
import { pubKeyHash, sign } from '../../../../../../scripts/p2p/crypto.mjs'
import {
	computeEventId,
	signPayloadBytes,
	sortedPrevEventIds,
	topologicalCanonicalOrder,
} from '../../../../../../scripts/p2p/dag.mjs'
import { nextHlc } from '../../../../../../scripts/p2p/hlc.mjs'
import {
	adminPubKeyHashes,
	emptyMaterializedState,
	foldAuthzEvent,
	materializeFromCheckpoint,
	memberChannelPermissions,
} from '../../../../../../scripts/p2p/materialized_state.mjs'
import { verifyOwnerSuccessionThreshold } from '../../../../../../scripts/p2p/owner_succession_ballot.mjs'
import { createDefaultRoles } from '../../../../../../scripts/p2p/permissions.mjs'

import { gcLogContextSidecars } from './context_sidecar.mjs'
import { readJsonl, appendJsonlSynced, writeJsonAtomic } from './dag_storage.mjs'
import { PUB_KEY_HASH_HEX, unsignedEventFields, validateSignature } from './dag_validator.mjs'
import { isPubKeyHashBlocked } from './dm_blocklist.mjs'
import {
	ensureFederationRoom,
	getFederationConfig,
	initFederationDagDeps,
} from './federation.mjs'
import {
	decryptEventContent,
	encryptEventContent,
	GSH_ENCRYPT_EVENT_TYPES,
} from './gsh_content.mjs'
import { applyGshRotationFromEvent, initGroupH } from './gsh_store.mjs'
import { assertGovernanceHlcSkewAllowed, DEFAULT_HLC_MAX_SKEW_MS, resolveHlcMaxSkewMs } from './hlc_policy.mjs'
import {
	chatDir,
	chatsRoot,
	snapshotPath,
	eventsPath,
	messagesPath,
	shellChatRoot,
} from './paths.mjs'
import {
	applyDecayCollusionAfterSlash,
	applyReputationResetToScores,
	applySubjectiveSlashFromEvent,
	seedMemberReputationFromIntroducer,
} from './reputation.mjs'
import { safeReadJson, safeRm, rethrowUnlessEnoentOrEnotdir } from './utils.mjs'
import { broadcastEvent, verifyPowSolution } from './websocket.mjs'

/**
 *
 */
export { requestMissingEventsGossip } from './federation.mjs'

/** 懒同步频道时视为「频道内载荷」的事件（其余类型在 `syncScope:channel` 下默认全量透传）。 */
const CHANNEL_SYNC_MESSAGE_TYPES = new Set([
	'message',
	'message_append',
	'message_edit',
	'message_delete',
	'message_feedback',
	'vote_cast',
	'reaction_add',
	'reaction_remove',
	'pin_message',
	'unpin_message',
])

/**
 * @param {object} e DAG 事件
 * @returns {string} 归一化频道 id（缺省为 `default`）
 */
export function effectiveEventChannelIdForSync(e) {
	const c = e.content && typeof e.content === 'object' ? e.content : {}
	const fromTop = typeof e.channelId === 'string' && e.channelId.trim() ? e.channelId.trim() : ''
	const fromContent = typeof c.channelId === 'string' && c.channelId.trim() ? c.channelId.trim() : ''
	return fromTop || fromContent || 'default'
}

/**
 * `syncScope:'channel'` 下是否应将该事件纳入对该频道的增量同步切片。
 * @param {object} e 事件
 * @param {string} channelId 目标频道
 * @returns {boolean} 是否纳入懒同步切片
 */
export function eventMatchesLazyChannelScope(e, channelId) {
	const t = e.type
	if (!CHANNEL_SYNC_MESSAGE_TYPES.has(t)) {
		if (t === 'list_item_update') {
			const c = e.content && typeof e.content === 'object' ? e.content : {}
			const cid = typeof c.channelId === 'string' ? c.channelId.trim() : ''
			return cid === channelId
		}
		return true
	}
	return effectiveEventChannelIdForSync(e) === channelId
}

/**
 * 计算当前 DAG 叶事件 id 集合（未被任何 `prev_event_ids` 引用的已存事件）。
 * @param {object[]} events 已排序的 JSONL 行
 * @returns {string[]} tip id 列表（文件顺序，非规范序）
 */
export function computeDagTipIds(events) {
	if (!events.length) return []
	const referenced = new Set()
	for (const ev of events) {
		const prevs = Array.isArray(ev.prev_event_ids) ? ev.prev_event_ids : []
		for (const p of prevs) 
			if (typeof p === 'string' && p) referenced.add(p)
		
	}
	const tips = []
	for (const ev of events) 
		if (typeof ev.id === 'string' && ev.id && !referenced.has(ev.id)) tips.push(ev.id)
	
	return tips
}

/**
 * 将当前所有 DAG 叶合并为单条多父事件（§0 多父汇合）。
 * @param {string} username 用户
 * @param {string} chatId 群
 * @param {string} sender 成员键（通常为会话用户名或 pubKeyHash）
 * @param {Uint8Array} [secretKey] 可选 Ed25519 私钥
 * @returns {Promise<object>} 签名后事件
 */
export async function mergeDagTips(username, chatId, sender, secretKey) {
	const rows = await readJsonl(eventsPath(username, chatId))
	const tips = computeDagTipIds(rows)
	if (tips.length < 2) throw new Error('dag_tip_merge: fewer than 2 tips')
	return appendEvent(username, chatId, {
		type: 'dag_tip_merge',
		sender,
		timestamp: Date.now(),
		content: { mergedTipCount: tips.length },
		prev_event_ids: sortedPrevEventIds(tips),
	}, secretKey)
}

/**
 * 校验频道 ID 是否合法（仅允许 [\w.-]，最长 128 字符）。
 * @param {unknown} id 待校验的频道 ID
 * @returns {boolean} 合法时为 true，否则为 false
 */
export function isValidChannelId(id) {
	return typeof id === 'string' && /^[\w.-]+$/.test(id) && id.length <= 128
}

/** 本进程 DAG 节点的随机 UUID，用于写入事件的 `node_id` 字段。 */
export const NODE_ID = randomUUID()

/**
 * 本地 `events.jsonl` 写入成功后向联邦网络广播已签名事件。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {object} signPayload 完整签名事件对象
 * @returns {Promise<void>} 广播尝试结束（无可用联邦连接时静默返回）
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
 * 校验远程 DAG 事件并追加到本地 `events.jsonl`（重复/非法则跳过）。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {object} signPayload 完整签名事件
 * @param {{ logFailures?: boolean }} [opts] 是否在控制台输出丢弃原因
 * @returns {Promise<'ok' | 'dup' | 'invalid'>} 写入结果
 */
export async function appendValidatedRemoteEvent(username, chatId, signPayload, opts = {}) {
	const logFailures = opts.logFailures !== false
	if (!signPayload || typeof signPayload !== 'object') return 'invalid'
	const signedEvent = /** @type {Record<string, unknown>} */ signPayload
	if (!signedEvent.id || typeof signedEvent.id !== 'string') return 'invalid'

	const path = eventsPath(username, chatId)
	const prev = await readJsonl(path)
	if (prev.some(existing => existing.id === signedEvent.id)) return 'dup'

	const bodyForId = unsignedEventFields(/** @type {object} */ signPayload)
	if (computeEventId(bodyForId) !== signedEvent.id) {
		if (logFailures) console.error('federation: drop remote event (id mismatch)')
		return 'invalid'
	}

	const { state } = await getState(username, chatId)
	try {
		await validateSignature(username, chatId, bodyForId, /** @type {any} */ signPayload, /** @type {any} */ signPayload, undefined, state)
	}
	catch (e) {
		if (logFailures) console.error('federation: drop remote event (signature)', e)
		return 'invalid'
	}

	if (signedEvent.type === 'reputation_reset') {
		const rt = typeof signedEvent.content?.targetPubKeyHash === 'string'
			? signedEvent.content.targetPubKeyHash.trim().toLowerCase()
			: ''
		if (rt && isPubKeyHashBlocked(username, rt)) {
			if (logFailures) console.error('federation: drop reputation_reset (target locally blocked)')
			return 'invalid'
		}
	}

	try {
		assertGovernanceHlcSkewAllowed(signedEvent, resolveHlcMaxSkewMs(state))
	}
	catch (e) {
		if (logFailures) console.error('federation: drop remote event (HLC governance skew)', e)
		return 'invalid'
	}

	await appendJsonlSynced(path, signPayload)
	await broadcastAndPersist(username, chatId, /** @type {object} */ signPayload, {})
	return 'ok'
}

/**
 * 校验并入库远程 DAG 事件；不向联邦二次广播以防回环。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {unknown} payload Trystero 收到的载荷或 `{ event }` 包装对象
 * @returns {Promise<void>} 处理结束（丢弃非法/重复事件亦为正常完成）
 */
async function ingestRemoteEvent(username, chatId, payload) {
	let signPayload = payload
	if (payload && typeof payload === 'object' && 'event' in /** @type {object} */ payload
		&& typeof /** @type {{ event?: object }} */ payload.event === 'object'
		&& /** @type {{ event?: object }} */ payload.event)
		signPayload = /** @type {{ event: object }} */ payload.event
	if (!signPayload || typeof signPayload !== 'object') return
	await appendValidatedRemoteEvent(username, chatId, /** @type {object} */ signPayload, { logFailures: true })
}

// ─── 写入频道消息流的事件类型 ─────────────────────────────────────────────────

const PERSIST_MESSAGE_TYPES = new Set([
	'message', 'message_append', 'message_edit', 'message_delete', 'message_feedback',
	'vote_cast', 'pin_message', 'unpin_message',
	'reaction_add', 'reaction_remove',
])

/**
 * @param {object} state 物化群状态
 * @returns {string} 用于治理权限折叠的频道 id
 */
function governanceChannelIdForPermissions(state) {
	const def = state.groupSettings?.defaultChannelId
	if (def && state.channels?.[def]) return def
	const keys = Object.keys(state.channels || {})
	return keys[0] || 'default'
}

/**
 * 主观信誉侧效应：Slash/连坐/reset/新成员初值（§0.1、§0.3、§6.3）。
 * @param {string} username 用户名
 * @param {string} chatId 群 ID
 * @param {object} signPayload 已落盘事件
 * @returns {Promise<void>}
 */
async function applyReputationHooks(username, chatId, signPayload) {
	if (!signPayload?.type) return
	if (signPayload.type === 'reputation_slash') {
		await applySubjectiveSlashFromEvent(username, chatId, signPayload)
		const { state } = await getState(username, chatId)
		const target = typeof signPayload.content?.targetPubKeyHash === 'string'
			? signPayload.content.targetPubKeyHash.trim().toLowerCase()
			: ''
		if (target)
			await applyDecayCollusionAfterSlash(username, chatId, target, state.inviteEdges || [])
	}
	if (signPayload.type === 'reputation_reset') {
		const t = typeof signPayload.content?.targetPubKeyHash === 'string'
			? signPayload.content.targetPubKeyHash.trim().toLowerCase()
			: ''
		if (t) await applyReputationResetToScores(username, chatId, t)
	}
	if (signPayload.type === 'member_join') {
		const sender = String(signPayload.sender || '').trim().toLowerCase()
		if (/^[0-9a-f]{64}$/iu.test(sender)) {
			const { state } = await getState(username, chatId)
			const edges = [...state.inviteEdges || []].reverse()
			let intro = ''
			let repE = 1
			for (const e of edges) {
				const to = typeof e.to === 'string' ? e.to.trim().toLowerCase() : ''
				if (to === sender) {
					intro = typeof e.from === 'string' ? e.from.trim().toLowerCase() : ''
					if (typeof e.rep_edge === 'number' && Number.isFinite(e.rep_edge)) repE = e.rep_edge
					break
				}
			}
			const cj = signPayload.content && typeof signPayload.content === 'object' ? signPayload.content : {}
			if (!intro && typeof cj.introducerPubKeyHash === 'string')
				intro = cj.introducerPubKeyHash.trim().toLowerCase()
			const fromMember = state.members?.[sender]
			const edgeFromJoin = typeof fromMember?.repEdgeFromIntroducer === 'number' && Number.isFinite(fromMember.repEdgeFromIntroducer)
				? fromMember.repEdgeFromIntroducer
				: repE
			await seedMemberReputationFromIntroducer(username, chatId, sender, intro, edgeFromJoin)
		}
	}
}

/**
 * DAG 事件落盘后：WebSocket 广播、按需写频道消息行并刷新 checkpoint。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {object} signPayload 已持久化的签名事件对象
 * @param {{ checkpointOwnerSecretKey?: Uint8Array }} [persistOpts] 可选群主私钥供 checkpoint 签名
 * @returns {Promise<void>} 广播与派生持久化完成
 */
async function broadcastAndPersist(username, chatId, signPayload, persistOpts = {}) {
	broadcastEvent(chatId, { type: 'dag_event', event: signPayload })
	try {
		await applyReputationHooks(username, chatId, signPayload)
	}
	catch (e) {
		console.error('reputation hooks failed', e)
	}
	try {
		await applyGshRotationFromEvent(username, chatId, signPayload)
	}
	catch (e) {
		console.error('gsh rotation hook failed', e)
	}
	if (!PERSIST_MESSAGE_TYPES.has(signPayload.type)) {
		await rebuildAndSaveCheckpoint(username, chatId, persistOpts)
		return
	}
	const channelId = signPayload.channelId || signPayload.content?.channelId || 'default'
	const storedContent = signPayload.content
	const displayContent = GSH_ENCRYPT_EVENT_TYPES.has(signPayload.type)
		? await decryptEventContent(username, chatId, channelId, storedContent)
		: storedContent
	const msgLine = {
		eventId: signPayload.id,
		type: signPayload.type,
		content: storedContent,
		sender: signPayload.sender,
		charId: signPayload.charId,
		timestamp: signPayload.timestamp,
		receivedAt: signPayload.received_at,
	}
	const channelMessagesPath = messagesPath(username, chatId, channelId)
	await appendJsonlSynced(channelMessagesPath, msgLine)
	broadcastEvent(chatId, {
		type: 'channel_message',
		channelId,
		message: { ...msgLine, content: displayContent },
	})
	await rebuildAndSaveCheckpoint(username, chatId, persistOpts)
	if (signPayload.type === 'message')
		void maybeAutoTriggerCharReply(username, chatId, channelId).catch(e => {
			console.error('maybeAutoTriggerCharReply failed:', e)
		})
}

// ─── 群组 CRUD ────────────────────────────────────────────────────────────────

/**
 * 创建新群：写入创世 `group_meta_update`、默认频道与默认频道设置事件。
 * @param {string} username 用户名
 * @param {object} body 建群参数（群 ID、名称、描述、默认频道与群主公钥哈希等）
 * @returns {Promise<{ groupId: string, checkpoint: object | null, defaultChannelId: string }>} 新群 ID、检查点与默认频道
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
		prev_event_ids: [],
		content: { name: body.name || geti18n('chat.group.defaults.groupMetaName'), desc: body.desc || '' },
		node_id: NODE_ID,
	}
	const id = computeEventId(unsignedEventFields(genesisBase))
	const signPayload = { ...unsignedEventFields(genesisBase), id, signature: '' }
	await mkdir(chatDir(username, chatId), { recursive: true })
	await appendJsonlSynced(eventsPath(username, chatId), signPayload)

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
		content: {
			defaultChannelId: initialChannelId,
			logicalStreamIdleMs: DEFAULT_LOGICAL_STREAM_IDLE_MS,
			hlcMaxSkewMs: DEFAULT_HLC_MAX_SKEW_MS,
			streamingSfuWss: null,
			maxDagPayloadBytes: 262_144,
		},
	})

	const owner = body.ownerPubKeyHash || 'local'
	const roles = createDefaultRoles()
	for (const [roleId, def] of Object.entries(roles)) 
		await appendEvent(username, chatId, {
			type: 'role_create',
			sender: 'local',
			timestamp: Date.now(),
			content: {
				roleId,
				name: def.name,
				color: def.color,
				position: def.position,
				permissions: def.permissions,
				isDefault: def.isDefault,
				isHoisted: def.isHoisted,
			},
		})
	
	await appendEvent(username, chatId, {
		type: 'member_join',
		sender: owner,
		timestamp: Date.now(),
		content: {},
	})
	await appendEvent(username, chatId, {
		type: 'role_assign',
		sender: 'local',
		timestamp: Date.now(),
		content: { targetPubKeyHash: owner, roleId: 'admin' },
	})

	await initGroupH(username, chatId)

	const { checkpoint, state } = await getState(username, chatId)
	return {
		groupId: chatId,
		checkpoint,
		defaultChannelId: state.groupSettings?.defaultChannelId ?? initialChannelId,
	}
}

/**
 * 每个聊天会话对应一个群（`groupId === chatId`）；若尚无 DAG 数据则创建。
 * @param {string} username 用户名
 * @param {string} chatId 与聊天页相同的群组/会话 ID
 * @param {object} [options] 可选建群参数（`name`、`desc`、`defaultChannelName`、`ownerPubKeyHash` 等）
 * @param {string} [options.name] 群显示名称
 * @param {string} [options.defaultChannelName] 首个文本频道的显示名
 * @returns {Promise<{ groupId: string, created: boolean }>} 群 ID 以及是否在本次调用中新建
 */
export async function ensureChat(username, chatId, options = {}) {
	const eventsFilePath = eventsPath(username, chatId)
	let out
	try {
		await access(eventsFilePath)
		out = { groupId: chatId, created: false }
	}
	catch {
		await createGroup(username, {
			groupId: chatId,
			name: options.name || geti18n('chat.group.defaults.dmChatName'),
			desc: options.desc,
			defaultChannelName: options.defaultChannelName || geti18n('chat.group.defaults.defaultChannelName'),
			ownerPubKeyHash: options.ownerPubKeyHash || username,
		})
		out = { groupId: chatId, created: true }
	}
	if (getFederationConfig(username).enabled)
		void ensureFederationRoom(username, chatId).catch(e => console.error(e))
	return out
}

/**
 * 递归删除群在磁盘上的数据目录（与 `deleteChat` 配套）。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @returns {Promise<void>} 删除尝试结束（目录不存在时忽略错误）
 */
export async function deleteChatData(username, chatId) {
	await safeRm(chatDir(username, chatId), { recursive: true, force: true })
}

// ─── 状态查询 ────────────────────────────────────────────────────────────────

/**
 * 载入 DAG 事件并按规范拓扑序物化，汇总状态与 checkpoint。
 * 若磁盘 checkpoint 含 `members_record` 且含有效 `checkpoint_event_id`，则从该事件之后增量折叠（否则全量重放）。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {{ forceFullReplay?: boolean }} [opts] 为 true 时忽略 checkpoint 增量路径并全量重放
 * @returns {Promise<{ events: object[], state: object, order: string[], checkpoint: object | null }>} 原始事件、物化状态、拓扑序与已存检查点
 */
export async function getState(username, chatId, opts = {}) {
	const events = await readJsonl(eventsPath(username, chatId))
	const checkpoint = await safeReadJson(snapshotPath(username, chatId))

	const order = topologicalCanonicalOrder(events.map(dagEvent => ({
		id: dagEvent.id,
		prev_event_ids: dagEvent.prev_event_ids,
		hlc: dagEvent.hlc,
		node_id: dagEvent.node_id,
		sender: dagEvent.sender,
	})))
	const byId = new Map(events.map(dagEvent => [dagEvent.id, dagEvent]))

	let state = emptyMaterializedState()
	const tipId = checkpoint?.checkpoint_event_id
	const canIncr = !opts.forceFullReplay
		&& checkpoint
		&& tipId
		&& checkpoint.members_record
		&& typeof checkpoint.members_record === 'object'
	const tipIdx = canIncr ? order.indexOf(tipId) : -1

	if (canIncr && !events.length)
		state = materializeFromCheckpoint(checkpoint)
	else if (canIncr && tipIdx >= 0) {
		state = materializeFromCheckpoint(checkpoint)
		for (const id of order.slice(tipIdx + 1)) {
			const event = byId.get(id)
			if (event) state = foldAuthzEvent(state, event)
		}
	}
	else 
		for (const id of order) {
			const event = byId.get(id)
			if (event) state = foldAuthzEvent(state, event)
		}
	

	return { events, state, order, checkpoint }
}

/**
 * 从 DAG 事件重放各频道置顶目标，生成 `messageOverlay.pins` 形状。
 * @param {object[]} events 全部或部分 DAG 事件列表
 * @returns {Record<string, string[]>} 频道 ID → 被置顶消息事件 ID 列表
 */
function foldPinOverlay(events) {
	const pinsByChannelId = new Map()
	for (const dagEvent of events) {
		const channelId = dagEvent.channelId || dagEvent.content?.channelId || 'default'
		if (!pinsByChannelId.has(channelId))
			pinsByChannelId.set(channelId, new Set())
		const pinSet = pinsByChannelId.get(channelId)
		if (dagEvent.type === 'pin_message' && dagEvent.content?.targetId)
			pinSet.add(String(dagEvent.content.targetId))
		if (dagEvent.type === 'unpin_message' && dagEvent.content?.targetId)
			pinSet.delete(String(dagEvent.content.targetId))
	}
	/** @type {Record<string, string[]>} */
	const pins = {}
	for (const [channelId, pinSet] of pinsByChannelId)
		if (pinSet.size)
			pins[channelId] = [...pinSet]
	return pins
}

/**
 * 重放 DAG 授权类事件并写回 `checkpoint.json`。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {{ checkpointOwnerSecretKey?: Uint8Array }} [opts] 可选群主私钥
 * @returns {Promise<object | null>} 新生成的检查点对象；无事件时返回 `null`
 */
export async function rebuildAndSaveCheckpoint(username, chatId, opts = {}) {
	const { events, state, order } = await getState(username, chatId, { forceFullReplay: true })
	if (!events.length) return null
	const last = events[events.length - 1]

	const previousCheckpoint = await safeReadJson(snapshotPath(username, chatId))

	const prevTip = previousCheckpoint?.checkpoint_event_id
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
	if (previousCheckpoint && !sameTip) {
		epoch_id = (previousCheckpoint.epoch_id ?? 0) + 1
		epoch_chain = Array.isArray(previousCheckpoint.epoch_chain) ? [...previousCheckpoint.epoch_chain] : []
		if (previousCheckpoint.epoch_id != null && previousCheckpoint.epoch_root_hash) 
			epoch_chain.push({
				epoch_id: previousCheckpoint.epoch_id,
				epoch_root_hash: previousCheckpoint.epoch_root_hash,
				checkpoint_event_id: previousCheckpoint.checkpoint_event_id,
			})
		
		if (epoch_chain.length > EPOCH_CHAIN_MAX)
			epoch_chain = epoch_chain.slice(-EPOCH_CHAIN_MAX)
	}
	else if (previousCheckpoint && sameTip) {
		epoch_id = previousCheckpoint.epoch_id ?? 1
		epoch_chain = Array.isArray(previousCheckpoint.epoch_chain) ? [...previousCheckpoint.epoch_chain] : []
		if (Array.isArray(previousCheckpoint.eventIdsInEpoch) && previousCheckpoint.eventIdsInEpoch.length)
			eventIdsInEpoch = previousCheckpoint.eventIdsInEpoch
	}

	const pins = foldPinOverlay(events)
	const fileIdx = Object.fromEntries(state.messageOverlay?.fileIndex ?? new Map())
	let checkpointPayload = buildCheckpointPayload({
		local_node_id: null,
		materialized: state,
		epoch_id,
		checkpoint_event_id: last.id,
		eventIdsInEpoch,
		overlay: { deletedIds: [], editHistory: {}, reactionCounts: {}, pins, fileIndex: fileIdx },
		fileFolders: { ...state.fileFolders || {} },
		epoch_chain,
	})
	const secretKey = opts.checkpointOwnerSecretKey
	if (secretKey && await canUseSecretKeyForCheckpointSignature(state, secretKey))
		checkpointPayload = await signCheckpoint(checkpointPayload, secretKey)
	await mkdir(chatDir(username, chatId), { recursive: true })
	await writeJsonAtomic(snapshotPath(username, chatId), checkpointPayload)
	return checkpointPayload
}

/**
 * @param {ReturnType<typeof emptyMaterializedState>} state 当前物化状态
 * @param {Uint8Array} secretKey 候选 Ed25519 私钥
 * @returns {Promise<boolean>} 是否可为 checkpoint 代群主签名
 */
async function canUseSecretKeyForCheckpointSignature(state, secretKey) {
	if (!secretKey || secretKey.length < 32) return false
	const { getPublicKey } = await import('npm:@noble/ed25519')
	const derivedPubKeyHash = pubKeyHash(getPublicKey(secretKey.slice(0, 32)))
	const delegatedOwnerPubKeyHash = state.delegatedOwnerPubKeyHash
	if (delegatedOwnerPubKeyHash) return derivedPubKeyHash === delegatedOwnerPubKeyHash
	return adminPubKeyHashes(state).has(derivedPubKeyHash)
}

// ─── DAG 事件追加 ─────────────────────────────────────────────────────────────

/**
 * 校验 `message` / `message_append` 可选载荷 `content_ref`（签名字段子集）。
 * @param {unknown} ref 引用对象
 * @returns {void}
 */
function validateContentRefPayload(ref) {
	if (!ref || typeof ref !== 'object') throw new Error('content_ref invalid')
	const r = /** @type {Record<string, unknown>} */ ref
	const h = typeof r.contentHash === 'string' && /^[0-9a-f]{64}$/iu.test(r.contentHash.trim())
	const alg = typeof r.alg === 'string' && Boolean(r.alg.trim())
	const byteLength = typeof r.byteLength === 'number' && Number.isFinite(r.byteLength) && r.byteLength >= 0
	const loc = typeof r.storageLocator === 'string' && Boolean(r.storageLocator.trim())
	if (!h || !alg || !byteLength || !loc)
		throw new Error('content_ref requires contentHash (64 hex), alg, byteLength, storageLocator')
}

/**
 * 追加一条 DAG 事件：分配 HLC、可选本地签名、规则校验后写入并广播。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {object} event 待追加事件体（`type`、`content`、`sender` 等）
 * @param {Uint8Array} [secretKey] 若提供则以该密钥本地签发
 * @returns {Promise<object>} 写入后的完整签名载荷对象
 */
export async function appendEvent(username, chatId, event, secretKey) {
	if (event.type === 'owner_succession_ballot') {
		const { state } = await getState(username, chatId)
		const admins = adminPubKeyHashes(state)
		const content = event.content || {}
		if (admins.size > 0) {
			const sigs = content.adminSignatures
			if (!Array.isArray(sigs) || !sigs.length) throw new Error('owner_succession_ballot requires adminSignatures')
			const ok = await verifyOwnerSuccessionThreshold({
				proposedOwnerPubKeyHash: content.proposedOwnerPubKeyHash,
				groupId: chatId,
				ballotId: content.ballotId || '',
				adminSignatures: sigs,
			}, admins)
			if (!ok) throw new Error('owner_succession_ballot verification failed')
		}
	}
	if (event.type === 'member_join') {
		const { state } = await getState(username, chatId)
		const joinPolicy = state.groupSettings?.joinPolicy || 'invite-only'
		const content = event.content || {}
		const activeBefore = Object.values(state.members || {}).filter(m => m?.status === 'active').length
		if (joinPolicy === 'invite-only' && !content.inviteCode && activeBefore > 0)
			throw new Error('member_join requires inviteCode')
		if (joinPolicy === 'pow') {
			const powDifficulty = Number(state.groupSettings?.powDifficulty) || 0
			if (powDifficulty <= 0) throw new Error('pow joinPolicy requires powDifficulty >= 1')
			if (!verifyPowSolution(username, chatId, powDifficulty, content.powSolution))
				throw new Error('invalid or expired pow solution')
		}
	}
	if (event.type === 'message' && PUB_KEY_HASH_HEX.test(String(event.sender))) {
		const channelId = event.channelId || event.content?.channelId || 'default'
		const { state } = await getState(username, chatId)
		const perms = memberChannelPermissions(state, event.sender, channelId)
		if (!perms.SEND_MESSAGES) throw new Error('SEND_MESSAGES denied')
	}
	if (event.type === 'message') {
		const mc = event.content && typeof event.content === 'object' ? event.content : {}
		if (mc.content_ref && typeof mc.content_ref === 'object')
			validateContentRefPayload(mc.content_ref)
	}
	if (event.type === 'message_append' && PUB_KEY_HASH_HEX.test(String(event.sender))) {
		const channelIdAppend = event.channelId || event.content?.channelId || 'default'
		const { state: stAppend } = await getState(username, chatId)
		const permsAppend = memberChannelPermissions(stAppend, event.sender, channelIdAppend)
		if (!permsAppend.SEND_MESSAGES) throw new Error('SEND_MESSAGES denied')
		const ac = event.content && typeof event.content === 'object' ? event.content : {}
		if (!String(ac.logical_stream_id || '').trim()) throw new Error('message_append requires content.logical_stream_id')
		if (ac.content_ref && typeof ac.content_ref === 'object')
			validateContentRefPayload(ac.content_ref)
	}
	if (event.type === 'file_upload' && PUB_KEY_HASH_HEX.test(String(event.sender))) {
		const { state } = await getState(username, chatId)
		const perms = memberChannelPermissions(state, event.sender, 'default')
		if (!perms.UPLOAD_FILES) throw new Error('UPLOAD_FILES denied')
	}
	if (event.type === 'reputation_reset') {
		const cr = event.content || {}
		const tgt = typeof cr.targetPubKeyHash === 'string' ? cr.targetPubKeyHash.trim().toLowerCase() : ''
		if (tgt && isPubKeyHashBlocked(username, tgt))
			throw new Error('reputation_reset ignored for locally blocked target')
		const { state } = await getState(username, chatId)
		const ch = governanceChannelIdForPermissions(state)
		const m = state.members[event.sender]
		if (!m || m.status !== 'active') throw new Error('reputation_reset requires active membership')
		const perms = memberChannelPermissions(state, event.sender, ch)
		if (!perms.ADMIN && !perms.MANAGE_ROLES) throw new Error('reputation_reset requires ADMIN or MANAGE_ROLES')
	}
	if (event.type === 'dag_tip_merge') {
		const rows = await readJsonl(eventsPath(username, chatId))
		const tips = computeDagTipIds(rows)
		if (tips.length < 2) throw new Error('dag_tip_merge: no fork')
		const expected = sortedPrevEventIds(tips)
		const got = sortedPrevEventIds(event.prev_event_ids)
		if (expected.length !== got.length || expected.some((v, i) => v !== got[i]))
			throw new Error('dag_tip_merge: prev_event_ids must list all current DAG tips')
		const { state } = await getState(username, chatId)
		const sender = String(event.sender || '')
		const m = state.members[sender]
		if (!m || m.status !== 'active') throw new Error('dag_tip_merge requires active member sender')
		const ch = governanceChannelIdForPermissions(state)
		const perms = memberChannelPermissions(state, sender, ch)
		if (!perms.MANAGE_CHANNELS) throw new Error('dag_tip_merge requires MANAGE_CHANNELS')
	}
	const authzLedgerTypes = new Set(['peer_invite', 'reputation_slash', 'reputation_reset'])
	if (authzLedgerTypes.has(event.type)) {
		const { state } = await getState(username, chatId)
		const m = state.members[event.sender]
		if (!m || m.status !== 'active') throw new Error('authz event requires active member sender')
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
	const prevFromCaller = Array.isArray(event.prev_event_ids) && event.prev_event_ids.length
		? event.prev_event_ids
		: last?.id ? [last.id] : []

	let eventForWrite = event
	if (GSH_ENCRYPT_EVENT_TYPES.has(event.type)) {
		const channelForGsh = event.channelId || event.content?.channelId || 'default'
		const plain = event.content && typeof event.content === 'object' ? event.content : {}
		const encrypted = await encryptEventContent(username, chatId, channelForGsh, plain)
		eventForWrite = { ...event, content: encrypted }
	}

	const base = {
		...eventForWrite,
		groupId: chatId,
		hlc,
		prev_event_ids: prevFromCaller,
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

	const { state: stateForSignature } = await getState(username, chatId)
	assertGovernanceHlcSkewAllowed(signPayload, resolveHlcMaxSkewMs(stateForSignature))
	await validateSignature(username, chatId, body, signPayload, event, secretKey, stateForSignature)

	await appendJsonlSynced(eventsPath(username, chatId), signPayload)
	await broadcastAndPersist(username, chatId, signPayload, { checkpointOwnerSecretKey: secretKey })
	await publishEventToFederation(username, chatId, signPayload)

	return signPayload
}

// ─── 频道管理 ─────────────────────────────────────────────────────────────────

/**
 * 通过 `channel_create` 事件创建频道。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {object} opts 频道参数（`channelId`、`type`、`name`、`syncScope`、私密标记等）
 * @returns {Promise<object>} `appendEvent` 返回的签名事件对象
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
 * 通过 `channel_update` 事件更新频道元数据。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {string} channelId 目标频道 ID
 * @param {object} [patch] 变更字段（可含 `sender` 覆盖发件人别名）
 * @returns {Promise<object>} `appendEvent` 返回的签名事件对象
 */
export async function updateChannel(username, chatId, channelId, patch = {}) {
	const { sender: patchSender = 'local', ...rest } = patch
	return appendEvent(username, chatId, {
		type: 'channel_update',
		sender: patchSender,
		timestamp: Date.now(),
		content: { channelId, ...rest },
	})
}

/**
 * 通过 `channel_delete` 事件删除频道（具体语义由物化层解释）。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {string} channelId 待删除频道 ID
 * @returns {Promise<object>} `appendEvent` 返回的签名事件对象
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
 * 列表型频道的条目更新（DAG `list_item_update`）。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {string} channelId 列表频道 ID
 * @param {Array<{ title?: string, desc?: string, targetChannelId?: string, url?: string }>} items 展示项增量列表
 * @param {string} [sender] 事件发件人别名或公钥哈希
 * @returns {Promise<object>} `appendEvent` 返回的签名事件对象
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
 * 置顶指定消息（DAG `pin_message`，并写入频道消息流）。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {string} targetEventId 被置顶消息的事件 ID
 * @param {string} [sender] 操作者别名或公钥哈希
 * @returns {Promise<object>} `appendEvent` 返回的签名事件对象
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
 * 取消置顶指定消息（DAG `unpin_message`）。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {string} targetEventId 被取消置顶的消息事件 ID
 * @param {string} [sender] 操作者别名或公钥哈希
 * @returns {Promise<object>} `appendEvent` 返回的签名事件对象
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
 * 记录群主或其代理节点的活跃心跳。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {{ ownerPubKeyHash: string, sender?: string }} body 群主公钥哈希与可选发件人
 * @returns {Promise<object>} `appendEvent` 返回的签名事件对象
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
 * 提交「执行官继任」治理投票（需达到管理员阈值联署）。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {{ proposedOwnerPubKeyHash: string, ballotId: string, adminSignatures: object[], sender?: string }} body 提议所有者、选票 ID 与管理员签名表
 * @returns {Promise<object>} `appendEvent` 返回的签名事件对象
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
 * 主动 GSH 密钥轮换（§6.3 `key_rotate`）：`ADMIN` 或 DM 双方均可发起，推导逻辑与 `member_kick` 一致。
 * 推导：`H_new = HASH(H_old || rotate_event_id || new_H_nonce)`。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {{ key_generation: number, new_H_nonce: string, sender?: string }} body 轮换参数
 * @returns {Promise<object>} `appendEvent` 返回的签名事件对象
 */
export async function appendKeyRotateEvent(username, chatId, body) {
	const { key_generation, new_H_nonce, sender = 'local' } = body
	if (typeof key_generation !== 'number' || !Number.isFinite(key_generation) || key_generation < 0)
		throw new Error('key_generation (non-negative integer) required')
	if (typeof new_H_nonce !== 'string' || !new_H_nonce.trim())
		throw new Error('new_H_nonce required')
	if (PUB_KEY_HASH_HEX.test(String(sender))) {
		const { state } = await getState(username, chatId)
		const ch = governanceChannelIdForPermissions(state)
		const perms = memberChannelPermissions(state, sender, ch)
		if (!perms.ADMIN && !perms.MANAGE_ROLES)
			throw new Error('key_rotate requires ADMIN or MANAGE_ROLES')
	}
	return appendEvent(username, chatId, {
		type: 'key_rotate',
		sender,
		timestamp: Date.now(),
		content: { key_generation: Math.floor(key_generation), new_H_nonce: new_H_nonce.trim() },
	})
}

/**
 * 将群文件元数据写入 DAG（不含明文 `aesKey`；§10.3 GSH KDF 方案下密钥由 `KDF(H,"file",fileId)` 推导）。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {object} meta 文件 ID、名称、大小、MIME、分块清单、上传时 H 代数等元信息
 * @param {number} [meta.key_generation] 上传时当前 GSH H 代数（§10.3 辅助 GC 与吊销判定）
 * @returns {Promise<object>} `appendEvent` 返回的签名事件对象
 */
export async function appendFileUploadEvent(username, chatId, meta) {
	const fileId = meta.fileId || randomUUID()
	const content = {
		fileId,
		name: meta.name,
		size: meta.size,
		mimeType: meta.mimeType,
		folderId: meta.folderId,
		chunkManifest: meta.chunkManifest || [],
	}
	if (typeof meta.key_generation === 'number' && Number.isFinite(meta.key_generation))
		content.key_generation = Math.floor(meta.key_generation)
	return appendEvent(username, chatId, {
		type: 'file_upload',
		sender: meta.sender || 'local',
		timestamp: Date.now(),
		content,
	})
}

/**
 * 追加 `file_delete` 事件（逻辑删除；§10.4）。
 * GSH 方案下密钥由 `KDF(H,"file",fileId)` 推导，踢人/`key_rotate` 后旧密钥自然失效，无需单独吊销。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {string} fileId 文件 ID
 * @param {string} [sender] 操作者别名或公钥哈希
 * @returns {Promise<object>} `appendEvent` 返回的签名事件对象
 */
export async function appendFileDeleteEvent(username, chatId, fileId, sender = 'local') {
	return appendEvent(username, chatId, {
		type: 'file_delete',
		sender,
		timestamp: Date.now(),
		content: { fileId },
	})
}

/**
 * 追加表情回应或撤销（`reaction_add` / `reaction_remove`）。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {{ type: 'reaction_add'|'reaction_remove', channelId: string, targetEventId: string, emoji: string, sender?: string, targetPubKeyHash?: string }} opts 反应类型、目标消息、表情与可选目标成员哈希
 * @returns {Promise<object>} `appendEvent` 返回的签名事件对象
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
 * 每条消息入库后评估：若配置了 `autoReplyFrequency` 则按计数触发 AI 自动回复广播。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<void>} 触发逻辑执行完毕（内部异常被吞掉）
 */
export async function maybeAutoTriggerCharReply(username, chatId, channelId) {
	try {
		const { state } = await getState(username, chatId)
		const freq = Number(state.groupSettings?.autoReplyFrequency) || 0
		if (freq <= 0) return
		const key = `${chatId}\0${channelId}`
		let freqTracker = autoFreqState.get(key)
		if (!freqTracker) { freqTracker = { lastTriggeredAt: 0, msgCount: 0 }; autoFreqState.set(key, freqTracker) }
		freqTracker.msgCount++
		if (freqTracker.msgCount < freq) return
		freqTracker.msgCount = 0
		freqTracker.lastTriggeredAt = Date.now()
		broadcastEvent(chatId, { type: 'ai_auto_trigger', channelId, groupId: chatId })
	}
	catch (e) {
		console.error('maybeAutoTriggerCharReply failed:', e)
	}
}

// ─── 同步 / 查询 ──────────────────────────────────────────────────────────────

/**
 * 分页返回 DAG 事件，供客户端增量同步与补拉。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {{ since?: string, limit?: number, channelId?: string }} q 游标 `since`、条数上限、可选 `channelId`（仅当该频道 `syncScope==='channel'` 时启用懒同步切片，§9）
 * @returns {Promise<{ events: object[], truncated: boolean }>} 事件切片及是否因上限被截断
 */
export async function syncEvents(username, chatId, q) {
	const events = await readJsonl(eventsPath(username, chatId))
	let work = events
	const channelId = typeof q.channelId === 'string' && q.channelId.trim() ? q.channelId.trim() : ''
	if (channelId) {
		const { state } = await getState(username, chatId)
		const scope = state.channels?.[channelId]?.syncScope
		if (scope === 'channel') {
			const order = topologicalCanonicalOrder(events.map(dagEvent => ({
				id: dagEvent.id,
				prev_event_ids: dagEvent.prev_event_ids,
				hlc: dagEvent.hlc,
				node_id: dagEvent.node_id,
				sender: dagEvent.sender,
			})))
			const byId = new Map(events.map(dagEvent => [dagEvent.id, dagEvent]))
			work = order.map(id => byId.get(id)).filter(Boolean).filter(e => eventMatchesLazyChannelScope(e, channelId))
		}
	}
	const limit = Math.min(Number(q.limit) || DEFAULT_MAX_CATCHUP_EVENTS, DEFAULT_MAX_CATCHUP_EVENTS)
	if (!q.since) {
		const slice = work.slice(-limit)
		return { events: slice, truncated: work.length > limit }
	}
	const idx = work.findIndex(dagEvent => dagEvent.id === q.since)
	const slice = idx === -1 ? work : work.slice(idx + 1)
	return { events: slice.slice(0, limit), truncated: slice.length > limit }
}

/**
 * 列出频道消息流 JSONL 中的展示行，支持 `before` 游标反向分页。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {{ before?: string, limit?: number }} q 可选早于某条消息的游标与最大条数
 * @returns {Promise<object[]>} 消息行对象数组
 */
export async function listChannelMessages(username, chatId, channelId, q) {
	const lines = await readJsonl(messagesPath(username, chatId, channelId))
	const { decryptChannelMessageLines } = await import('./gsh_content.mjs')
	const decrypted = await decryptChannelMessageLines(username, chatId, channelId, lines)
	const limit = Math.min(Number(q.limit) || 200, 500)
	if (!q.before) return decrypted.slice(-limit)
	const idx = decrypted.findIndex(line => line.eventId === q.before)
	if (idx <= 0) return []
	return decrypted.slice(Math.max(0, idx - limit), idx)
}

/**
 * 枚举当前用户聊天 shell 数据下出现过的所有会话/群 ID。
 * @param {string} username 用户名
 * @returns {Promise<string[]>} 去重后的群组 ID 列表
 */
export async function listUserGroups(username) {
	const root = shellChatRoot(username)
	const ids = new Set()
	try {
		const base = join(root, 'groups')
		const ents = await readdir(base, { withFileTypes: true })
		for (const d of ents)
			if (d.isDirectory()) ids.add(d.name)
	}
	catch (e) {
		rethrowUnlessEnoentOrEnotdir(e)
	}
	try {
		for (const f of await readdir(chatsRoot(username)))
			if (f.endsWith('.json')) ids.add(f.replace(/\.json$/u, ''))
	}
	catch (e) {
		rethrowUnlessEnoentOrEnotdir(e)
	}
	return [...ids]
}

/**
 * 返回用户可见群组列表及显示名（优先从各群 `checkpoint.json` 快读）。
 * @param {string} username 用户名
 * @returns {Promise<Array<{ id: string, name: string }>>} 群组 `id` 与展示用 `name` 数组
 */
export async function listUserGroupsWithMeta(username) {
	const ids = await listUserGroups(username)
	return Promise.all(ids.map(async id => {
		let name = id
		const loadedCheckpoint = await safeReadJson(snapshotPath(username, id))
		if (loadedCheckpoint?.groupMeta?.name) name = loadedCheckpoint.groupMeta.name
		return { id, name }
	}))
}

/**
 * 返回本进程 DAG 节点 ID（`NODE_ID`）。
 * @returns {string} 节点 UUID 字符串
 */
export function getNodeId() {
	return NODE_ID
}

/**
 * 获取群组的默认频道 ID：优先 `groupSettings.defaultChannelId`，否则取首个频道或 `default`。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @returns {Promise<string>} 解析得到的默认频道 ID
 */
export async function getDefaultChannelId(username, chatId) {
	try {
		const { state } = await getState(username, chatId)
		if (state.groupSettings?.defaultChannelId)
			return String(state.groupSettings.defaultChannelId)
		const ids = Object.keys(state.channels || {})
		return ids[0] || 'default'
	}
	catch {
		return 'default'
	}
}

/**
 * 基于物化状态查询某成员在指定频道的有效权限位图。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {string} pubKeyHash 成员 Ed25519 公钥哈希（64 位 hex）
 * @param {string} channelId 频道 ID
 * @returns {Promise<object>} 频道权限结构（如 `SEND_MESSAGES`、`UPLOAD_FILES` 等布尔位）
 */
export async function getEffectivePermissions(username, chatId, pubKeyHash, channelId) {
	const { state } = await getState(username, chatId)
	return memberChannelPermissions(state, pubKeyHash, channelId)
}

/**
 * 仅裁剪某频道 `messages/{channelId}.jsonl` 派生日志，保留尾部若干行。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {number} keepLastN 保留尾部条数
 * @returns {Promise<void>}
 */
export async function pruneChannelMessagesJsonl(username, chatId, channelId, keepLastN) {
	const path = messagesPath(username, chatId, channelId)
	const lines = await readJsonl(path)
	const n = Math.max(0, Number(keepLastN) || 0)
	const kept = n ? lines.slice(-n) : []
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, kept.map(messageLine => JSON.stringify(messageLine)).join('\n') + (kept.length ? '\n' : ''), 'utf8')
	await gcLogContextSidecars(username, chatId)
}

/**
 * 先写 checkpoint，再裁剪频道消息 JSONL，再按侧车可达性根做 `gcLogContextSidecars`。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {number} keepLastN 每条 JSONL 保留尾部条数
 * @returns {Promise<void>}
 */
export async function compactAndPruneChannelMessages(username, chatId, channelId, keepLastN) {
	const savedCheckpoint = await compactGroupCheckpoint(username, chatId)
	await pruneEventsJsonlAfterCheckpoint(username, chatId, savedCheckpoint)
	const path = messagesPath(username, chatId, channelId)
	const lines = await readJsonl(path)
	const n = Math.max(0, Number(keepLastN) || 0)
	const kept = n ? lines.slice(-n) : []
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, kept.map(messageLine => JSON.stringify(messageLine)).join('\n') + (kept.length ? '\n' : ''), 'utf8')
	await gcLogContextSidecars(username, chatId)
}

/**
 * 重写 checkpoint.json（裁剪 events 前应先调用以固化权限状态）。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @returns {Promise<object | null>} 新检查点或 null
 */
export async function compactGroupCheckpoint(username, chatId) {
	return rebuildAndSaveCheckpoint(username, chatId)
}

/**
 * 在已有带 `members_record` 的检查点前提下，将 `events.jsonl` 裁剪为拓扑序中自 `checkpoint_event_id` 起的后缀（此前事件已由 checkpoint 覆盖）。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @param {object | null} [checkpointHint] 刚写入的检查点对象；不传则从磁盘读取
 * @returns {Promise<{ pruned: boolean, kept: number, dropped: number }>} 是否发生裁剪及条数统计
 */
export async function pruneEventsJsonlAfterCheckpoint(username, chatId, checkpointHint = null) {
	/** @type {object | null} */
	let checkpoint = checkpointHint
	if (!checkpoint) 
		try {
			checkpoint = JSON.parse(await readFile(snapshotPath(username, chatId), 'utf8'))
		}
		catch {
			return { pruned: false, kept: 0, dropped: 0 }
		}
	

	const tipId = checkpoint?.checkpoint_event_id
	if (!tipId || typeof tipId !== 'string' || !checkpoint?.members_record || typeof checkpoint.members_record !== 'object')
		return { pruned: false, kept: 0, dropped: 0 }

	const eventsFilePath = eventsPath(username, chatId)
	const events = await readJsonl(eventsFilePath)
	if (!events.length) return { pruned: false, kept: 0, dropped: 0 }

	const order = topologicalCanonicalOrder(events.map(dagEvent => ({
		id: dagEvent.id,
		prev_event_ids: dagEvent.prev_event_ids,
		hlc: dagEvent.hlc,
		node_id: dagEvent.node_id,
		sender: dagEvent.sender,
	})))
	const tipIdx = order.indexOf(tipId)
	if (tipIdx < 0) return { pruned: false, kept: events.length, dropped: 0 }

	const byId = new Map(events.map(dagEvent => [dagEvent.id, dagEvent]))
	const kept = order.slice(tipIdx).map(id => byId.get(id)).filter(Boolean)
	const dropped = events.length - kept.length
	if (dropped <= 0) return { pruned: false, kept: kept.length, dropped: 0 }

	await mkdir(dirname(eventsFilePath), { recursive: true })
	await writeFile(eventsFilePath, kept.map(dagEvent => JSON.stringify(dagEvent)).join('\n') + (kept.length ? '\n' : ''), 'utf8')
	return { pruned: true, kept: kept.length, dropped }
}

/**
 * 供联邦层解析 Trystero 房间名时读取物化状态（避免 `federation.mjs` 与 `dag.mjs` 循环依赖）。
 * @param {string} username 用户名
 * @param {string} chatId 群组 ID
 * @returns {Promise<{ state: object }>} 物化状态
 */
async function getStateForFederation(username, chatId) {
	const { state } = await getState(username, chatId)
	return { state }
}

initFederationDagDeps({
	nodeId: NODE_ID,
	readJsonl,
	appendValidatedRemoteEvent,
	ingestRemoteEvent,
	getStateForFederation,
})
