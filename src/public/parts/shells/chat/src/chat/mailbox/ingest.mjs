import { registerMailboxConsumer, unregisterMailboxConsumer } from '../../../../../../../scripts/p2p/mailbox/consumer_registry.mjs'
import { publishMailboxRecord, requestMailboxFromNetwork } from '../../../../../../../scripts/p2p/mailbox/deliver_or_store.mjs'
import {
	deleteMailboxRecords,
	takeMailboxForRecipient,
} from '../../../../../../../scripts/p2p/mailbox/store.mjs'
import { getNodeHash } from '../../../../../../../scripts/p2p/node_context.mjs'
import { resolveLocalEventSigner } from '../dag/localSigner.mjs'
import { appendValidatedRemoteEvent } from '../dag/remoteIngest.mjs'

const MAILBOX_APP_CHAT = 'chat'

/**
 * @param {string} username replica
 * @param {object[]} records mailbox 记录
 * @returns {Promise<string[]>} 已交付 record id
 */
async function consumeChatDagMailbox(username, records) {
	/** @type {string[]} */
	const delivered = []
	for (const row of records) {
		if (!row?.envelope || String(row.app || '') !== MAILBOX_APP_CHAT) continue
		const groupId = String(row.groupId || '').trim()
		if (!groupId) continue
		const status = await appendValidatedRemoteEvent(username, groupId, row.envelope, { logFailures: false })
		if (status === 'ok' || status === 'dup') delivered.push(row.id)
	}
	return delivered
}

/**
 * Chat Load：注册 DAG mailbox 消费者。
 * @returns {void}
 */
export function registerChatMailboxConsumer() {
	registerMailboxConsumer(MAILBOX_APP_CHAT, consumeChatDagMailbox)
}

/** @returns {void} */
export function unregisterChatMailboxConsumer() {
	unregisterMailboxConsumer(MAILBOX_APP_CHAT)
}

/**
 * @param {string} username replica
 * @param {object} signedEvent 签名 DAG 事件
 * @param {string} toPubKeyHash 收件人 pubKeyHash
 * @param {{ groupId?: string, channelId?: string, dmSessionTag?: string, toNodeHash?: string }} [meta] 投递元数据
 * @returns {Promise<void>} 无返回值
 */
export async function dispatchMailboxMessage(username, signedEvent, toPubKeyHash, meta = {}) {
	const nodeHash = getNodeHash()
	await publishMailboxRecord(username, toPubKeyHash, {
		app: MAILBOX_APP_CHAT,
		groupId: meta.groupId ?? signedEvent.groupId,
		channelId: meta.channelId ?? signedEvent.channelId,
		dmSessionTag: meta.dmSessionTag,
		envelope: signedEvent,
		fromNodeHash: nodeHash,
	}, meta.toNodeHash || '')
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<number>} 摄入条数
 */
export async function pullMailboxForLocalMember(username, groupId) {
	const { sender } = await resolveLocalEventSigner(username, groupId)
	const rows = await takeMailboxForRecipient(sender)
	const ids = await consumeChatDagMailbox(username, rows)
	if (ids.length) await deleteMailboxRecords(ids)
	return ids.length
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<void>} 无返回值
 */
export async function onFederationRoomReadyForMailbox(username, groupId) {
	await pullMailboxForLocalMember(username, groupId)
	const { sender } = await resolveLocalEventSigner(username, groupId)
	await requestMailboxFromNetwork(username, sender)
}

