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
 * @param {object} options commit 选项
 * @param {{ forceAwait?: boolean }} [publishOpts] 出站等待策略
 * @returns {Promise<void>}
 */
async function publishSignedEvent(username, groupId, wirePayload, options, publishOpts = {}) {
	const awaitSend = publishOpts.forceAwait || options.federationExistingSlotOnly || options.federationJoinTimeoutMs > 0
	const publish = publishSignedEventToFederation(username, groupId, wirePayload, {
		state: options.federationState,
		existingSlotOnly: options.federationExistingSlotOnly,
		joinTimeoutMs: options.federationJoinTimeoutMs,
		awaitSend,
	})
	if (awaitSend)
		await publish
	else
		void publish.catch(error => console.error('federation: background publish failed', error))
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object | (() => object | Promise<object>)} wirePayload canonical 签名事件，或锁内签名回调（返回 wirePayload）
 * @param {{ checkpointOwnerSecretKey?: Uint8Array, publishFederation?: boolean, skipCheckpointRebuild?: boolean, federationState?: object, federationExistingSlotOnly?: boolean, federationJoinTimeoutMs?: number, ingress?: 'live' | 'backfill' }} [options] 落盘选项
 * @returns {Promise<'ok' | 'dup'>} `dup` 表示同 eventId 已落盘（锁内原子判定）
 */
export async function commitSignedChatEvent(username, groupId, wirePayload, options = {}) {
	const persistOpts = {
		checkpointOwnerSecretKey: options.checkpointOwnerSecretKey,
		skipCheckpointRebuild: options.skipCheckpointRebuild,
		skipGenesisSideEffects: options.skipGenesisSideEffects,
		ingress: options.ingress,
	}

	// 需在落盘前完成联邦出站的事件：退群（checkpoint 重建会删盘/teardown slot）与 roomSecret 轮换
	// （必须在旧房还活着时把新口令送达仍留在旧房的成员；落盘后再发旧槽已被物化失效）。
	// member_ban 则须先落盘（denylist 挡下被封成员后再 live 发布），但发布须 force-await 确保合法第三方及时收到。
	let publishBeforePersist = false
	const committed = await withGroupWriteLock(username, groupId, async () => {
		if (wirePayload instanceof Function) wirePayload = wirePayload()
		wirePayload = await wirePayload
		publishBeforePersist = options.publishFederation && (
			wirePayload.type === 'member_leave'
			|| (wirePayload.type === 'group_settings_update' && !!wirePayload.content?.roomSecret)
		)
		const path = eventsPath(username, groupId)
		const idNorm = String(wirePayload.id).trim()
		const previous = await readJsonl(path, { sanitize: stripDagEventLocalExtensions })
		if (previous.some(existing => String(existing.id).trim() === idNorm)) return false
		await appendJsonlSynced(path, wirePayload)
		await recordEventReceivedAt(username, groupId, wirePayload.id, Date.now())
		if (!publishBeforePersist)
			await broadcastAndPersist(username, groupId, wirePayload, persistOpts)
		return true
	})
	if (!committed) return 'dup'

	if (publishBeforePersist) {
		// 事件既已落盘就必须物化（房间轮换/退群 side effect），live 发布失败仅降级为后续 catchup 兜底。
		let publishError
		try {
			await publishSignedEvent(username, groupId, wirePayload, options, { forceAwait: true })
		}
		catch (error) {
			publishError = error
		}
		await withGroupWriteLock(username, groupId, async () => {
			await broadcastAndPersist(username, groupId, wirePayload, persistOpts)
		})
		if (publishError) throw publishError
	}
	else if (options.publishFederation)
		await publishSignedEvent(username, groupId, wirePayload, options, { forceAwait: wirePayload.type === 'member_ban' })

	recordMessageRate(username, groupId, wirePayload, options.federationState?.groupSettings)
	return 'ok'
}
