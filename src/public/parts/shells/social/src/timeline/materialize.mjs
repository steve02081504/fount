import { createLruMap } from '../../../../../../scripts/memo.mjs'
import { readJsonlTipId } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { materializeFromEvents } from 'npm:@steve02081504/fount-p2p/timeline/materialize_runner'
import { timelineEventsPath, timelineSnapshotPath } from '../paths.mjs'

import { readTimelineEvents } from './append.mjs'
import {
	createSocialTimelineState,
	finalizeSocialTimelineView,
	SOCIAL_TIMELINE_REDUCERS,
} from './reducers.mjs'

const TIMELINE_VIEW_CACHE_MAX = 256

/** @type {ReturnType<typeof createLruMap<Map<string, { tipId: string | null, view: object }>>>} */
const timelineViewCache = createLruMap(TIMELINE_VIEW_CACHE_MAX)

/**
 * @param {string} username 用户
 * @param {string} entityHash 时间线 owner
 * @returns {Map<string, { tipId: string | null, view: object }>} 该用户的 entity 物化缓存桶
 */
function timelineCacheBucket(username) {
	let bucket = timelineViewCache.get(username)
	if (!bucket) {
		bucket = new Map()
		timelineViewCache.touch(username, bucket)
	}
	return bucket
}

/**
 * 时间线 events 变更后失效内存物化缓存。
 * @param {string} username 用户
 * @param {string} entityHash 时间线 owner
 * @returns {void}
 */
export function invalidateTimelineMaterializedCache(username, entityHash) {
	const target = String(entityHash).toLowerCase()
	const inner = timelineViewCache.get(username)
	if (!inner) return
	inner.delete(target)
	if (!inner.size) timelineViewCache.delete(username)
}

/**
 * 将原始时间线事件物化为 reducer 视图。
 * @param {object[]} events 原始事件
 * @returns {object} 物化视图
 */
export function materializeTimeline(events) {
	const { state, order } = materializeFromEvents(events, SOCIAL_TIMELINE_REDUCERS, createSocialTimelineState)
	return finalizeSocialTimelineView(state, order)
}

/**
 * 读取磁盘上的物化快照（不重新计算）。
 * @param {string} username 用户
 * @param {string} entityHash 时间线 owner
 * @returns {Promise<object | null>} 缓存快照
 */
export async function loadTimelineSnapshot(username, entityHash) {
	try {
		const { readFile } = await import('node:fs/promises')
		return JSON.parse(await readFile(timelineSnapshotPath(username, entityHash), 'utf8'))
	}
	catch {
		return null
	}
}

/**
 * @param {object | null} cached 磁盘快照
 * @param {string | null} tipId 当前 events.jsonl DAG tip
 * @returns {boolean} 快照是否与 tip 一致
 */
function snapshotMatchesTip(cached, tipId) {
	return cached?.checkpoint_event_id === tipId
}

/**
 * 读取并物化时间线（只读：不写 snapshot、不跑 retention）。
 * @param {string} username 用户
 * @param {string} entityHash 时间线 owner
 * @returns {Promise<object>} 物化视图
 */
export async function getTimelineMaterialized(username, entityHash) {
	if (!parseEntityHash(entityHash)) throw new Error('invalid entityHash')
	const eventsPath = timelineEventsPath(username, entityHash)
	const entityKey = String(entityHash).toLowerCase()
	const tipId = await readJsonlTipId(eventsPath)

	const bucket = timelineCacheBucket(username)
	const memoryHit = bucket.get(entityKey)
	if (memoryHit && memoryHit.tipId === tipId)
		return memoryHit.view

	const cached = await loadTimelineSnapshot(username, entityHash)
	if (snapshotMatchesTip(cached, tipId)) {
		const entry = { tipId, view: cached }
		bucket.set(entityKey, entry)
		timelineViewCache.touch(username, bucket)
		return entry.view
	}

	const events = await readTimelineEvents(username, entityHash)
	const view = materializeTimeline(events)
	bucket.set(entityKey, { tipId, view })
	timelineViewCache.touch(username, bucket)
	return view
}

/**
 * 显式维护：写 signed snapshot + 运行 retention（写路径或独立 endpoint 调用）。
 * @param {string} username 用户
 * @param {string} entityHash 时间线 owner
 * @returns {Promise<object>} 落盘后的 signed snapshot
 */
export async function maintainSocialTimeline(username, entityHash) {
	const entityKey = String(entityHash).toLowerCase()
	const eventsPath = timelineEventsPath(username, entityHash)
	const tipId = await readJsonlTipId(eventsPath)
	const view = await getTimelineMaterialized(username, entityKey)
	const snapshot = {
		entityHash: entityKey,
		checkpoint_event_id: tipId,
		materializedAt: Date.now(),
		...view,
	}
	const { rebuildSignedTimelineSnapshot } = await import('./rebuildCheckpoint.mjs')
	const signedSnapshot = await rebuildSignedTimelineSnapshot(username, entityKey, snapshot)
	const { runSocialTimelineMaintenance } = await import('./retention.mjs')
	await runSocialTimelineMaintenance(username, entityKey, signedSnapshot, view.socialMeta)
	const bucket = timelineCacheBucket(username)
	bucket.set(entityKey, { tipId, view: signedSnapshot })
	timelineViewCache.touch(username, bucket)
	return signedSnapshot
}
