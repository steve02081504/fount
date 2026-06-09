import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { topologicalCanonicalOrder } from '../dag/index.mjs'
import { readJsonl, writeJsonlSynced } from '../dag/storage.mjs'
import { descendantClosureFromTip } from '../governance_branch.mjs'
import { invalidateTopologicalOrderMemo } from '../topo_order_memo.mjs'

/**
 * 将 events.jsonl 裁剪为 checkpoint 起后代闭包（连通子图，非拓扑下标切片）。
 * @param {string} eventsFilePath events.jsonl 路径
 * @param {object | null} checkpoint 含 checkpoint_event_id 的快照
 * @param {(row: object) => object} [sanitize] 行规范化
 * @returns {Promise<{ pruned: boolean, kept: number, dropped: number }>} 裁剪统计
 */
export async function pruneEventsJsonlAfterCheckpoint(eventsFilePath, checkpoint, sanitize = row => row) {
	const tipId = checkpoint?.checkpoint_event_id
	if (!tipId) return { pruned: false, kept: 0, dropped: 0 }
	const events = await readJsonl(eventsFilePath, { sanitize })
	if (!events.length) return { pruned: false, kept: 0, dropped: 0 }
	const byId = new Map(events.map(dagEvent => [dagEvent.id, dagEvent]))
	if (!byId.has(tipId)) return { pruned: false, kept: events.length, dropped: 0 }

	const keepIds = descendantClosureFromTip(tipId, byId)
	const order = topologicalCanonicalOrder(events.map(dagEvent => ({
		id: dagEvent.id,
		prev_event_ids: dagEvent.prev_event_ids,
		hlc: dagEvent.hlc,
		node_id: dagEvent.node_id,
		sender: dagEvent.sender,
	})))
	const kept = order.map(id => byId.get(id)).filter(ev => ev && keepIds.has(ev.id))
	const dropped = events.length - kept.length
	if (dropped <= 0) return { pruned: false, kept: kept.length, dropped: 0 }
	await mkdir(dirname(eventsFilePath), { recursive: true })
	await writeJsonlSynced(eventsFilePath, kept)
	invalidateTopologicalOrderMemo(eventsFilePath)
	return { pruned: true, kept: kept.length, dropped }
}
