import { readJsonl } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { normalizeHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { sanitizeFederatedEvent } from '../events/wire.mjs'
import { eventsPath } from '../lib/paths.mjs'

/**
 * 从 DAG 扫描各频道最新 HPKE wrap（不依赖物化 state 中的全员 wraps）。
 * @param {object[]} events DAG 事件
 * @param {string} recipientPubKeyHash 64 hex
 * @returns {Record<string, { generation: number, wrap: object }>} channelId → wrap
 */
export function latestChannelKeyWrapsFromEvents(events, recipientPubKeyHash) {
	const recipient = normalizeHex64(recipientPubKeyHash)
	if (!recipient) return {}
	/** @type {Record<string, { generation: number, wrap: object }>} */
	const out = {}
	for (const event of events) {
		if (event.type === 'channel_key_rotate') {
			const channelId = String(event.content?.channelId || '').trim()
			const generation = Number(event.content?.generation)
			const wrap = event.content?.wraps?.[recipient]
			if (channelId && Number.isFinite(generation) && wrap)
				out[channelId] = { generation, wrap }
		}
		if (event.type === 'channel_key_rotate_batch')
			for (const rot of event.content?.rotations || []) {
				const channelId = String(rot?.channelId || '').trim()
				const generation = Number(rot?.generation)
				const wrap = rot?.wraps?.[recipient]
				if (channelId && Number.isFinite(generation) && wrap)
					out[channelId] = { generation, wrap }
			}
	}
	return out
}

/**
 * 各频道 recipient 的全部 wrap 代际（升序 generation）。
 * @param {object[]} events DAG 事件
 * @param {string} recipientPubKeyHash 64 hex
 * @returns {Record<string, Array<{ generation: number, wrap: object }>>} 频道 → 代际 wrap 列表
 */
export function allChannelKeyWrapsFromEvents(events, recipientPubKeyHash) {
	const recipient = normalizeHex64(recipientPubKeyHash)
	if (!recipient) return {}
	/** @type {Record<string, Map<number, object>>} */
	const byChannel = {}
	/**
	 * @param {string} channelId 频道 ID
	 * @param {number} generation 密钥代际
	 * @param {object} wrap HPKE wrap
	 * @returns {void}
	 */
	const ingest = (channelId, generation, wrap) => {
		if (!channelId || !Number.isFinite(generation) || !wrap) return
		if (!byChannel[channelId]) byChannel[channelId] = new Map()
		byChannel[channelId].set(generation, wrap)
	}
	for (const event of events) {
		if (event.type === 'channel_key_rotate') {
			const channelId = String(event.content?.channelId || '').trim()
			const generation = Number(event.content?.generation)
			const wrap = event.content?.wraps?.[recipient]
			ingest(channelId, generation, wrap)
		}
		if (event.type === 'channel_key_rotate_batch')
			for (const rot of event.content?.rotations || [])
				ingest(
					String(rot?.channelId || '').trim(),
					Number(rot?.generation),
					rot?.wraps?.[recipient],
				)
	}
	/** @type {Record<string, Array<{ generation: number, wrap: object }>>} */
	const out = {}
	for (const [channelId, gens] of Object.entries(byChannel))
		out[channelId] = [...gens.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([generation, wrap]) => ({ generation, wrap }))
	return out
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} recipientPubKeyHash 64 hex
 * @returns {Promise<Record<string, { generation: number, wrap: object }>>} 频道 → 最新 wrap
 */
export async function loadLatestChannelKeyWrapsForRecipient(username, groupId, recipientPubKeyHash) {
	const events = await readJsonl(eventsPath(username, groupId), { sanitize: sanitizeFederatedEvent })
	return latestChannelKeyWrapsFromEvents(events, recipientPubKeyHash)
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} recipientPubKeyHash 64 hex
 * @returns {Promise<Record<string, Array<{ generation: number, wrap: object }>>>} 频道 → 代际 wrap 列表
 */
export async function loadAllChannelKeyWrapsForRecipient(username, groupId, recipientPubKeyHash) {
	const events = await readJsonl(eventsPath(username, groupId), { sanitize: sanitizeFederatedEvent })
	return allChannelKeyWrapsFromEvents(events, recipientPubKeyHash)
}
