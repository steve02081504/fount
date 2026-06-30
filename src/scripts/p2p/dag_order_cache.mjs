/**
 * DAG 拓扑序磁盘缓存（events.order.json）：增量合并，避免每次全量 Kahn。
 */
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
	computeLocalTipsHash,
	sortedPrevEventIds,
	topologicalCanonicalOrder,
} from './dag/index.mjs'
import { computeDagTipIdsFromEvents } from './governance_branch.mjs'

/**
 * @param {object[]} events DAG 事件行
 * @returns {Array<{ id: string, prev_event_ids?: unknown, hlc?: object, node_id?: string, sender?: string }>} 拓扑排序用 meta
 */
export function eventsToMetas(events) {
	return events.map(event => ({
		id: event.id,
		prev_event_ids: event.prev_event_ids,
		hlc: event.hlc,
		node_id: event.node_id,
		sender: event.sender,
	}))
}

/**
 * 将新增事件按父指针插入已有拓扑序之后。
 * @param {string[]} cachedOrder 已缓存序
 * @param {object[]} events 全量事件
 * @returns {string[]} 合并后的 id 序
 */
export function mergeTopologicalOrder(cachedOrder, events) {
	const byId = new Map(events.map(event => [event.id, event]))
	const merged = cachedOrder.filter(id => byId.has(id))
	const orderSet = new Set(merged)
	const newEvents = events.filter(event => !orderSet.has(event.id))
	if (!newEvents.length) return merged

	const newOrder = topologicalCanonicalOrder(eventsToMetas(newEvents))
	for (const id of newOrder) {
		if (orderSet.has(id)) continue
		const event = byId.get(id)
		let insertAt = merged.length
		for (const parentId of sortedPrevEventIds(event?.prev_event_ids)) {
			const parentIdx = merged.indexOf(parentId)
			if (parentIdx >= 0) insertAt = Math.max(insertAt, parentIdx + 1)
		}
		merged.splice(insertAt, 0, id)
		orderSet.add(id)
	}
	return merged
}

/**
 * @param {object[]} events 全量事件
 * @param {object | null} cache 磁盘缓存
 * @param {{ forceFull?: boolean }} [opts] 选项
 * @returns {string[]} 拓扑序 id 列表
 */
export function resolveEventTopologicalOrder(events, cache, opts = {}) {
	if (!events.length) return []
	if (opts.forceFull)
		return topologicalCanonicalOrder(eventsToMetas(events))

	const byId = new Map(events.map(event => [event.id, event]))
	const tips = computeDagTipIdsFromEvents(events)
	const tipsHash = computeLocalTipsHash(tips)
	const eventCount = events.length

	if (cache && Array.isArray(cache.order) && cache.order.length) {
		if (cache.tipsHash === tipsHash && cache.eventCount === eventCount) {
			const ok = cache.order.length === eventCount && cache.order.every(id => byId.has(id))
			if (ok) return cache.order
		}
		if (cache.eventCount <= eventCount && cache.order.every(id => byId.has(id))) {
			const merged = mergeTopologicalOrder(cache.order, events)
			if (merged.length === eventCount) return merged
		}
	}

	return topologicalCanonicalOrder(eventsToMetas(events))
}

/**
 * @param {string[]} order 拓扑序
 * @param {object[]} events 全量事件
 * @returns {{ order: string[], tipsHash: string, eventCount: number }} 可写入 events.order.json
 */
export function buildOrderCachePayload(order, events) {
	const tips = computeDagTipIdsFromEvents(events)
	return {
		order,
		tipsHash: computeLocalTipsHash(tips),
		eventCount: events.length,
	}
}

/**
 * @param {string} path `events.order.json` 路径
 * @returns {Promise<object | null>} 缓存或 null
 */
export async function readOrderCache(path) {
	try {
		return JSON.parse(await readFile(path, 'utf8'))
	}
	catch {
		return null
	}
}

/**
 * 写入拓扑序缓存。纯性能缓存：写失败（如群目录在并发清理/拆群时被删，Windows 上 open 报
 * EPERM、或 ENOENT/EBUSY）不应让物化抛错或上浮告警，静默忽略即可，下次读盘自会重建。
 * @param {string} path 路径
 * @param {object} payload 缓存体
 * @returns {Promise<void>}
 */
export async function writeOrderCache(path, payload) {
	try {
		await mkdir(dirname(path), { recursive: true })
		await writeFile(path, JSON.stringify(payload), 'utf8')
	}
	catch { /* best-effort cache: dir removed mid-teardown / transient FS error */ }
}

/**
 * @param {string} path 路径
 * @returns {Promise<void>}
 */
export async function deleteOrderCache(path) {
	try {
		await unlink(path)
	}
	catch { /* absent */ }
}
