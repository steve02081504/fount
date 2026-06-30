import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { topologicalCanonicalOrder } from '../dag/index.mjs'
import { readJsonl, writeJsonlSynced } from '../dag/storage.mjs'
import { computeDagTipIdsFromEvents, selectConsensusBranchTip } from '../governance_branch.mjs'
import { computeRetentionKeepIds } from '../retention_policy.mjs'
import { invalidateTopologicalOrderMemo } from '../topo_order_memo.mjs'

/**
 * @param {string} eventsFilePath events.jsonl 路径
 * @param {object | null} checkpointHint 检查点提示
 * @param {{ maxDepth: number, maxMs: number, anchorTypes: Set<string> }} policy 保留策略
 * @param {(row: object) => object} sanitize 行规范化
 * @returns {Promise<{ pruned: boolean, kept: number, dropped: number }>} 裁剪统计
 */
export async function enforceTimelineEventRetention(
	eventsFilePath,
	checkpointHint,
	policy,
	sanitize = row => row,
) {
	const events = await readJsonl(eventsFilePath, { sanitize })
	if (!events.length) return { pruned: false, kept: 0, dropped: 0 }
	const maxDepth = Math.max(256, Number(policy.maxDepth) || 200_000)
	const maxMs = Math.max(3_600_000, Number(policy.maxMs) || 365 * 24 * 3600 * 1000)
	const cutoffWall = Date.now() - maxMs
	const byId = new Map(events.map(e => [e.id, e]))
	const order = topologicalCanonicalOrder(events.map(e => ({
		id: e.id,
		prev_event_ids: e.prev_event_ids,
		hlc: e.hlc,
		node_id: e.node_id,
		sender: e.sender,
	})))
	const tips = computeDagTipIdsFromEvents(events)
	const branchTipId = selectConsensusBranchTip(tips, byId)
	const checkpointTipId = checkpointHint?.checkpoint_event_id || null
	const keepIds = computeRetentionKeepIds(order, byId, {
		maxDepth,
		cutoffWall,
		anchorTypes: policy.anchorTypes,
		checkpointTipId,
		branchTipId,
	})
	if (keepIds.size >= events.length) return { pruned: false, kept: events.length, dropped: 0 }
	const kept = order.map(id => byId.get(id)).filter(ev => ev && keepIds.has(ev.id))
	const dropped = events.length - kept.length
	if (dropped <= 0) return { pruned: false, kept: kept.length, dropped: 0 }
	await mkdir(dirname(eventsFilePath), { recursive: true })
	await writeJsonlSynced(eventsFilePath, kept)
	invalidateTopologicalOrderMemo(eventsFilePath)
	return { pruned: true, kept: kept.length, dropped }
}
