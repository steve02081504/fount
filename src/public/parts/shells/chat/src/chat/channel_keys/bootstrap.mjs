import { loadAllChannelKeyWrapsForRecipient } from './wrapsFromEvents.mjs'

/**
 * 从 DAG 收集各频道全部 wrap 代际（入群/补拉 bootstrap）。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} recipientPubKeyHash 64 hex
 * @returns {Promise<Record<string, Array<{ generation: number, wrap: object }>>>}
 */
export async function collectChannelKeyWrapsForRecipient(username, groupId, recipientPubKeyHash) {
	return loadAllChannelKeyWrapsForRecipient(username, groupId, recipientPubKeyHash)
}
