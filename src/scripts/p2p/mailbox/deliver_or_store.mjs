import { deliver, deliverToUserRoomPeers } from '../deliver.mjs'
import { normalizeHex64 } from '../hexIds.mjs'
import { allowMailboxRelayForTier } from '../mailbox_importance.mjs'
import { takeIncomingMailboxPutSlot } from '../mailbox_rate.mjs'
import { getNodeHash } from '../node_context.mjs'

import { getMailboxRoutingSettings } from './settings.mjs'
import { mailboxTierFromHop, storeMailboxRecord } from './store.mjs'

/**
 * @param {string} username replica（trust graph 投递上下文）
 * @param {object} opts 投递选项
 * @returns {Promise<{ stored: boolean, delivered: boolean, relayed: number }>}
 */
export async function deliverOrStoreMailboxPut(username, opts) {
	const routing = getMailboxRoutingSettings()
	const toPubKeyHash = normalizeHex64(opts.toPubKeyHash)
	if (!toPubKeyHash) return { stored: false, delivered: false, relayed: 0 }
	const hop = Math.max(0, Number(opts.hop) || 0)
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
	const delivered = toNodeHash
		? await deliver(username, toNodeHash, 'mailbox_put', { nodeHash, record })
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
 * @returns {Promise<{ stored: boolean, delivered: boolean, relayed: number }>}
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
 * @returns {Promise<void>}
 */
export async function ingestMailboxPut(ctx, put) {
	const routing = getMailboxRoutingSettings()
	const { record } = put
	if (!record?.envelope || !record?.toPubKeyHash) return
	const fromNode = String(put.nodeHash || '').trim()
	if (!fromNode || !takeIncomingMailboxPutSlot(fromNode)) return
	const hop = Number(record.hop) || 0
	if (hop >= routing.maxHop) return
	const username = String(ctx?.replicaUsername || '').trim()
	if (!username) return
	await deliverOrStoreMailboxPut(username, {
		toPubKeyHash: record.toPubKeyHash,
		record: {
			...record,
			fromNodeHash: fromNode,
		},
		hop: hop + 1,
	})
}

/**
 * @param {{ replicaUsername?: string }} ctx
 * @param {object} want mailbox_want 载荷
 * @param {(payload: unknown, peerId: string) => void} sendGive
 * @param {string} peerId
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
	).filter(row => row.toPubKeyHash === recipient && row.tier !== 'quarantine')
	if (!rows.length) return
	sendGive({ toPubKeyHash: recipient, records: rows.slice(0, 32) }, peerId)
}

/**
 * @param {{ replicaUsername?: string }} ctx
 * @param {object} give mailbox_give 载荷
 * @returns {Promise<number>}
 */
export async function ingestMailboxGive(ctx, give) {
	const records = give.records || []
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
	const routing = getMailboxRoutingSettings()
	const { listMailboxIdsForRecipient } = await import('./store.mjs')
	const recipient = normalizeHex64(toPubKeyHash)
	if (!recipient) return
	await deliverToUserRoomPeers(username, 'mailbox_want', {
		toPubKeyHash: recipient,
		ids: (await listMailboxIdsForRecipient(recipient)).slice(0, 64),
	}, null, routing.wantFanout)
}
