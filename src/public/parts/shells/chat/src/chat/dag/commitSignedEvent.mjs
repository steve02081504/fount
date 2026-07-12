/**
 * 已验签 Chat DAG 事件落盘 + 广播 + 联邦发布（local / federation 共用）。
 */
import { appendJsonlSynced, readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'
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
 * @param {object} opts commit 选项
 * @param {{ forceAwait?: boolean }} [publishOpts] 出站等待策略
 * @returns {Promise<void>}
 */
async function publishSignedEvent(username, groupId, wirePayload, opts, publishOpts = {}) {
	const publish = publishSignedEventToFederation(username, groupId, wirePayload, {
		state: opts.federationState,
		existingSlotOnly: opts.federationExistingSlotOnly,
		joinTimeoutMs: opts.federationJoinTimeoutMs,
	})
	const awaitPublish = publishOpts.forceAwait
		|| opts.federationExistingSlotOnly
		|| opts.federationJoinTimeoutMs > 0
	if (awaitPublish)
		await publish
	else
		void publish.catch(error => console.error('federation: background publish failed', error))
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} wirePayload canonical 签名事件
 * @param {{ checkpointOwnerSecretKey?: Uint8Array, publishFederation?: boolean, skipCheckpointRebuild?: boolean, federationState?: object, federationExistingSlotOnly?: boolean, federationJoinTimeoutMs?: number }} [opts] 落盘选项
 * @returns {Promise<'ok' | 'dup'>} `dup` 表示同 eventId 已落盘（锁内原子判定）
 */
export async function commitSignedChatEvent(username, groupId, wirePayload, opts = {}) {
	// 退群联邦出站须在 broadcastAndPersist 之前完成：完整 checkpoint 重建会 maybePurgeLocalReplicaIfLeft
	// 删掉 events.jsonl 并 teardown slot，晚于 rebuild 的 publish 读不到 leave 帧。
	const publishLeaveBeforeRebuild = opts.publishFederation && wirePayload.type === 'member_leave'
	const persistOpts = {
		checkpointOwnerSecretKey: opts.checkpointOwnerSecretKey,
		skipCheckpointRebuild: opts.skipCheckpointRebuild,
		skipGenesisSideEffects: opts.skipGenesisSideEffects,
	}

	const committed = await withGroupWriteLock(username, groupId, async () => {
		const path = eventsPath(username, groupId)
		const idNorm = String(wirePayload.id).trim().toLowerCase()
		const previous = await readJsonl(path, { sanitize: stripDagEventLocalExtensions })
		if (previous.some(existing => String(existing.id).trim().toLowerCase() === idNorm)) return false
		await appendJsonlSynced(path, wirePayload)
		await recordEventReceivedAt(username, groupId, wirePayload.id, Date.now())
		if (!publishLeaveBeforeRebuild)
			await broadcastAndPersist(username, groupId, wirePayload, persistOpts)
		return true
	})
	if (!committed) return 'dup'

	if (publishLeaveBeforeRebuild) {
		await publishSignedEvent(username, groupId, wirePayload, opts, { forceAwait: true })
		await withGroupWriteLock(username, groupId, async () => {
			await broadcastAndPersist(username, groupId, wirePayload, persistOpts)
		})
	}
	else if (opts.publishFederation)
		await publishSignedEvent(username, groupId, wirePayload, opts)

	recordMessageRate(username, groupId, wirePayload, opts.federationState?.groupSettings)
	return 'ok'
}
