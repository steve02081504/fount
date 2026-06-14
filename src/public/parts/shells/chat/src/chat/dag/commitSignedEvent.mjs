/**
 * 已验签 Chat DAG 事件落盘 + 广播 + 联邦发布（local / federation 共用）。
 */
import { appendJsonlSynced } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { recordEventReceivedAt } from '../events/meta.mjs'
import { publishSignedEventToFederation } from '../federation/index.mjs'
import { recordMessageRate } from '../governance/rateLimitState.mjs'
import { eventsPath } from '../lib/paths.mjs'

import { broadcastAndPersist } from './eventPersist.mjs'
import { withGroupWriteLock } from './groupLock.mjs'
import { getState } from './materialize.mjs'

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} wirePayload canonical 签名事件
 * @param {{ checkpointOwnerSecretKey?: Uint8Array, publishFederation?: boolean, skipCheckpointRebuild?: boolean, federationState?: object, federationExistingSlotOnly?: boolean, federationJoinTimeoutMs?: number }} [opts] 落盘选项
 * @returns {Promise<void>}
 */
export async function commitSignedChatEvent(username, groupId, wirePayload, opts = {}) {
	await withGroupWriteLock(username, groupId, async () => {
		await appendJsonlSynced(eventsPath(username, groupId), wirePayload)
		await recordEventReceivedAt(username, groupId, wirePayload.id, Date.now())
		await broadcastAndPersist(username, groupId, wirePayload, {
			checkpointOwnerSecretKey: opts.checkpointOwnerSecretKey,
			skipCheckpointRebuild: opts.skipCheckpointRebuild,
			skipGenesisSideEffects: opts.skipGenesisSideEffects,
		})
	})
	recordMessageRate(username, groupId, wirePayload)
	if (opts.publishFederation) {
		const { state } = await getState(username, groupId)
		await publishSignedEventToFederation(username, groupId, wirePayload, {
			state,
			existingSlotOnly: opts.federationExistingSlotOnly,
			joinTimeoutMs: opts.federationJoinTimeoutMs,
		})
	}
	
}
