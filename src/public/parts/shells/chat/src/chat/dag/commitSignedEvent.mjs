/**
 * 已验签 Chat DAG 事件落盘 + 广播 + 联邦发布（local / federation 共用）。
 */
import { appendJsonlSynced, readJsonl } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { stripDagEventLocalExtensions } from '../../../../../../../scripts/p2p/dag/strip_extensions.mjs'
import { recordEventReceivedAt } from '../events/meta.mjs'
import { publishSignedEventToFederation } from '../federation/index.mjs'
import { recordMessageRate } from '../governance/rateLimitState.mjs'
import { eventsPath } from '../lib/paths.mjs'

import { broadcastAndPersist } from './eventPersist.mjs'
import { withGroupWriteLock } from './groupLock.mjs'

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} wirePayload canonical 签名事件
 * @param {{ checkpointOwnerSecretKey?: Uint8Array, publishFederation?: boolean, skipCheckpointRebuild?: boolean, federationState?: object, federationExistingSlotOnly?: boolean, federationJoinTimeoutMs?: number }} [opts] 落盘选项
 * @returns {Promise<'ok' | 'dup'>} `dup` 表示同 eventId 已落盘（锁内原子判定）
 */
export async function commitSignedChatEvent(username, groupId, wirePayload, opts = {}) {
	const committed = await withGroupWriteLock(username, groupId, async () => {
		const path = eventsPath(username, groupId)
		const idNorm = String(wirePayload.id).trim().toLowerCase()
		const previous = await readJsonl(path, { sanitize: stripDagEventLocalExtensions })
		if (previous.some(existing => String(existing.id).trim().toLowerCase() === idNorm)) return false
		await appendJsonlSynced(path, wirePayload)
		await recordEventReceivedAt(username, groupId, wirePayload.id, Date.now())
		await broadcastAndPersist(username, groupId, wirePayload, {
			checkpointOwnerSecretKey: opts.checkpointOwnerSecretKey,
			skipCheckpointRebuild: opts.skipCheckpointRebuild,
			skipGenesisSideEffects: opts.skipGenesisSideEffects,
		})
		return true
	})
	if (!committed) return 'dup'
	recordMessageRate(username, groupId, wirePayload, opts.federationState?.groupSettings)
	if (opts.publishFederation) {
		// 本地落盘/物化/WS 广播已在上面的写锁内同步完成（前端即时可见）。
		// 出站到 Nostr relay 是 best-effort：仅当调用方显式要求有界等待（leaveFast / 邀请激活）时才 await；
		// 常规写路径 fire-and-forget，绝不让 relay 不可达/慢拖慢 HTTP；漏传事件由联邦 catch-up 最终补齐。
		const publish = publishSignedEventToFederation(username, groupId, wirePayload, {
			state: opts.federationState,
			existingSlotOnly: opts.federationExistingSlotOnly,
			joinTimeoutMs: opts.federationJoinTimeoutMs,
		})
		if (opts.federationExistingSlotOnly || opts.federationJoinTimeoutMs > 0)
			await publish
		else
			void publish.catch(error => console.error('federation: background publish failed', error))
	}
	return 'ok'
}
