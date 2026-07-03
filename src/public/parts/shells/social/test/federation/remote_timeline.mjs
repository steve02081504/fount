/**
 * 联邦时间线测试辅助：构造并 ingest 远程签名事件。
 */
import { Buffer } from 'node:buffer'

/**
 * 生成随机 32 字节种子。
 * @returns {Uint8Array} 32 字节随机种子。
 */
export function randomSeed() {
	return new Uint8Array(Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))))
}

/**
 * 构造远程签名时间线事件（不经过本地 ingest）。
 * @param {Uint8Array} secretKey - 发送方私钥种子。
 * @param {string} ownerEntityHash - 时间线所属实体 hash。
 * @param {object} event - 事件字段（type、content 等）。
 * @returns {Promise<object>} 已签名事件对象。
 */
export async function makeRemoteSignedEvent(secretKey, ownerEntityHash, event) {
	const { pubKeyHash, publicKeyFromSeed } = await import('fount/scripts/p2p/crypto.mjs')
	const { signTimelineEvent } = await import('fount/scripts/p2p/timeline/append_core.mjs')
	const { timelineGroupId } = await import('fount/scripts/p2p/social_namespace.mjs')
	const sender = pubKeyHash(publicKeyFromSeed(secretKey))
	return signTimelineEvent({
		type: event.type,
		groupId: timelineGroupId(ownerEntityHash),
		sender,
		charPartName: event.charPartName ?? null,
		timestamp: event.timestamp ?? Date.now(),
		hlc: event.hlc ?? { wall: Date.now(), counter: 0, node: sender.slice(0, 8) },
		prev_event_ids: event.prev_event_ids ?? [],
		content: event.content ?? {},
		node_id: event.node_id ?? 'remote-test',
	}, secretKey)
}

/**
 * 按序 ingest 多条远程签名事件到本地时间线。
 * @param {string} username - 目标用户。
 * @param {Uint8Array} seed - 远程发送方私钥种子。
 * @param {string} ownerEntityHash - 时间线所属实体 hash。
 * @param {object[]} eventSpecs - 事件规格列表（按序链接 prev_event_ids）。
 * @returns {Promise<object[]>} 已 ingest 的签名事件数组。
 */
export async function seedRemoteTimeline(username, seed, ownerEntityHash, eventSpecs) {
	const { ingestRemoteTimelineEvent } = await import('fount/public/parts/shells/social/src/timeline/sync.mjs')
	const signed = []
	let previousEventId = null
	let wallClock = Date.now() - eventSpecs.length
	for (const spec of eventSpecs) {
		const event = await makeRemoteSignedEvent(seed, ownerEntityHash, {
			...spec,
			prev_event_ids: previousEventId ? [previousEventId] : [],
			hlc: { wall: wallClock++, counter: 0, node: 'remote-test' },
		})
		if (!await ingestRemoteTimelineEvent(username, ownerEntityHash, event))
			throw new Error(`seedRemoteTimeline: ingest rejected ${spec.type}`)
		previousEventId = event.id
		signed.push(event)
	}
	return signed
}
