import { normalizeHex64 } from '../hexIds.mjs'
import { allowMailboxRelayForTier } from '../mailbox_importance.mjs'
import { takeIncomingMailboxPutSlot } from '../mailbox_rate.mjs'
import { getNodeTransportSettings, getNodeHash } from '../node/identity.mjs'
import { DEFAULT_TRUST_GRAPH_OWNER, requireTrustGraphProvider } from '../trust_graph_registry.mjs'
import { deliverToUserRoomPeers, ensureUserRoom } from '../user_room.mjs'

import { resolveMailboxRoutingForPeerCount } from './settings.mjs'
import {
	isDeliverableMailboxRecord,
	isMailboxRecordWithinSizeLimit,
	mailboxEnvelopeId,
	mailboxTierFromHop,
	normalizeMailboxHop,
	relayHopAfterWireIngress,
	storeMailboxRecord,
	getMailboxRecords,
} from './store.mjs'

/**
 * @param {string} username replica
 * @param {string} peerId Trystero peer id
 * @returns {Promise<string | null>} 已验证的 remote nodeHash
 */
async function resolveRemoteNodeHashForPeer(username, peerId) {
	if (!peerId) return null
	const slot = await ensureUserRoom({ replicaUsername: username })
	const entry = slot?.getRoster()?.find(row => row.peerId === peerId)
	const remote = entry?.remoteNodeHash?.trim().toLowerCase()
	return remote || null
}

/**
 * @param {object} record 入站 record
 * @returns {Promise<number>} 本节点应存储的 hop
 */
async function resolveRelayHopForIngress(record) {
	let id
	try {
		id = mailboxEnvelopeId(record.envelope)
	}
	catch {
		return relayHopAfterWireIngress(record.hop)
	}
	const existing = (await getMailboxRecords([id]))[0]
	return relayHopAfterWireIngress(record.hop, existing?.hop)
}

/**
 * @param {string} username replica
 * @returns {Promise<{ maxHop: number, relayFanoutTrusted: number, relayFanoutNormal: number, wantFanout: number, batterySaver: boolean }>} 按在线 peer 数缩放的路由
 */
async function resolveRouting(username) {
	const { batterySaver, mailbox } = getNodeTransportSettings()
	const slot = await ensureUserRoom({ replicaUsername: username })
	const peerCount = slot?.getRoster()?.length ?? 0
	return resolveMailboxRoutingForPeerCount(peerCount, mailbox, batterySaver)
}

/**
 * @param {string} username replica（trust graph 投递上下文）
 * @param {object} opts 投递选项
 * @returns {Promise<{ stored: boolean, delivered: boolean, relayed: number }>} 存转结果
 */
export async function deliverOrStoreMailboxPut(username, opts) {
	const routing = await resolveRouting(username)
	const toPubKeyHash = normalizeHex64(opts.toPubKeyHash)
	if (!toPubKeyHash) return { stored: false, delivered: false, relayed: 0 }
	const hop = normalizeMailboxHop(opts.hop)
	if (hop >= routing.maxHop) return { stored: false, delivered: false, relayed: 0 }
	const tier = mailboxTierFromHop(hop)
	const nodeHash = getNodeHash()
	const record = {
		...opts.record,
		toPubKeyHash,
		hop,
		tier,
		fromNodeHash: opts.record?.fromNodeHash || nodeHash,
	}
	const stored = await storeMailboxRecord(record)
	const toNodeHash = opts.toNodeHash?.trim().toLowerCase()
	const delivered = toNodeHash && isMailboxRecordWithinSizeLimit(record)
		? await requireTrustGraphProvider(DEFAULT_TRUST_GRAPH_OWNER).sendToNode(username, toNodeHash, 'mailbox_put', { nodeHash, record })
		: false

	let relayed = 0
	const relayFanout = tier === 'trusted' ? routing.relayFanoutTrusted : routing.relayFanoutNormal
	if (stored && hop < routing.maxHop && allowMailboxRelayForTier(tier))
		relayed = await deliverToUserRoomPeers(username, 'mailbox_put', { record }, null, relayFanout)

	return { stored, delivered, relayed }
}

/**
 * @param {string} username replica
 * @param {string} toPubKeyHash 收件人
 * @param {object} record 待发 record
 * @param {string} [toNodeHash] 已知在线节点时直投
 * @returns {Promise<{ stored: boolean, delivered: boolean, relayed: number }>} 存转结果
 */
export async function publishMailboxRecord(username, toPubKeyHash, record, toNodeHash = '') {
	return deliverOrStoreMailboxPut(username, {
		toPubKeyHash,
		toNodeHash: toNodeHash || undefined,
		record: { ...record, toPubKeyHash },
		hop: 0,
	})
}

/**
 * @param {{ replicaUsername?: string }} ctx 入站上下文
 * @param {object} put 入站 mailbox_put
 * @param {string} [peerId] Trystero 对端 id（有则校验 nodeHash 绑定）
 * @returns {Promise<void>}
 */
export async function ingestMailboxPut(ctx, put, peerId = '') {
	const { record } = put
	if (!record?.envelope || !record?.toPubKeyHash) return
	const fromNode = normalizeHex64(put.nodeHash)
	if (!fromNode || !takeIncomingMailboxPutSlot(fromNode)) return
	const username = String(ctx?.replicaUsername || '').trim()
	if (!username) return
	if (peerId) {
		const remote = await resolveRemoteNodeHashForPeer(username, peerId)
		if (!remote || remote !== fromNode) return
	}
	const routing = await resolveRouting(username)
	const relayHop = await resolveRelayHopForIngress(record)
	if (relayHop >= routing.maxHop) return
	await deliverOrStoreMailboxPut(username, {
		toPubKeyHash: record.toPubKeyHash,
		record: {
			...record,
			fromNodeHash: fromNode,
		},
		hop: relayHop,
	})
}

/**
 * @param {{ replicaUsername?: string }} ctx 入站上下文
 * @param {object} want mailbox_want 载荷
 * @param {(payload: unknown, peerId: string) => void} sendGive mailbox_give 发送回调
 * @param {string} peerId 请求方 peer
 * @returns {Promise<void>}
 */
export async function respondMailboxWant(ctx, want, sendGive, peerId) {
	const { getMailboxRecords, takeMailboxForRecipient } = await import('./store.mjs')
	const recipient = normalizeHex64(want.toPubKeyHash)
	if (!recipient) return
	const ids = Array.isArray(want.ids) ? want.ids : []
	const rows = (ids.length
		? await getMailboxRecords(ids)
		: await takeMailboxForRecipient(recipient)
	).filter(row => row.toPubKeyHash === recipient && isDeliverableMailboxRecord(row))
	if (!rows.length) return
	sendGive({ toPubKeyHash: recipient, records: rows.slice(0, 32) }, peerId)
}

/**
 * @param {{ replicaUsername?: string }} ctx 入站上下文
 * @param {object} give mailbox_give 载荷
 * @returns {Promise<number>} 投递给消费者的记录数
 */
export async function ingestMailboxGive(ctx, give) {
	const records = (give.records || []).filter(isDeliverableMailboxRecord)
	if (!records.length) return 0
	const username = String(ctx?.replicaUsername || '').trim()
	if (!username) return 0
	const { dispatchMailboxRecordsToConsumers } = await import('./consumer_registry.mjs')
	const { deleteMailboxRecords } = await import('./store.mjs')
	const delivered = await dispatchMailboxRecordsToConsumers(username, records)
	if (delivered.length) await deleteMailboxRecords(delivered)
	return delivered.length
}

/**
 * @param {string} username replica
 * @param {string} toPubKeyHash 本机收件人 pubKeyHash
 * @returns {Promise<void>}
 */
export async function requestMailboxFromNetwork(username, toPubKeyHash) {
	const routing = await resolveRouting(username)
	const { listMailboxIdsForRecipient } = await import('./store.mjs')
	const recipient = normalizeHex64(toPubKeyHash)
	if (!recipient) return
	await deliverToUserRoomPeers(username, 'mailbox_want', {
		toPubKeyHash: recipient,
		ids: (await listMailboxIdsForRecipient(recipient)).slice(0, 64),
	}, null, routing.wantFanout)
}
