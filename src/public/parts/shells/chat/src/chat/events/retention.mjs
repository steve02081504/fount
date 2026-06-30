/**
 * 【文件】`events/retention.mjs` — DAG 事件流保留与裁剪（§7.1）。
 * 【职责】按群设置裁剪 `events.jsonl`，保留权限锚点与 checkpoint 可达后缀。
 */
import { readFile } from 'node:fs/promises'

import { stripDagEventLocalExtensions } from '../../../../../../../scripts/p2p/dag/strip_extensions.mjs'
import {
	computeRetentionKeepIds,
} from '../../../../../../../scripts/p2p/retention_policy.mjs'
import { enforceDagRetention } from '../../../../../../../scripts/p2p/timeline/retention_runner.mjs'
import { PERMISSION_ANCHOR_TYPES } from '../dag/eventTypes.mjs'
import { eventsPath, snapshotPath } from '../lib/paths.mjs'

/** 自 `p2p/retention_policy` 再导出。 */
export { computeRetentionKeepIds }

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object | null} checkpoint 快照
 * @returns {Promise<object | null>} 检查点对象
 */
async function readCheckpoint(username, groupId, checkpoint) {
	if (checkpoint) return checkpoint
	try {
		return JSON.parse(await readFile(snapshotPath(username, groupId), 'utf8'))
	}
	catch {
		return null
	}
}

/**
 * 应用群设置中的事件保留窗口；在 `rebuildAndSaveCheckpoint` 之后调用。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object | null} [checkpointHint] 刚写入的检查点
 * @param {{ event_retention_depth?: unknown, event_retention_ms?: unknown }} [groupSettings] 群设置
 * @returns {Promise<{ pruned: boolean, kept: number, dropped: number }>} 裁剪统计
 */
export async function enforceEventRetention(username, groupId, checkpointHint = null, groupSettings = {}) {
	const eventsFilePath = eventsPath(username, groupId)
	const maxDepth = Math.max(256, Number(groupSettings.event_retention_depth) || 200_000)
	const maxMs = Math.max(3_600_000, Number(groupSettings.event_retention_ms) || 365 * 24 * 3600 * 1000)
	return enforceDagRetention({
		eventsFilePath,
		/** @returns {Promise<object | null>} 检查点 */
		readCheckpoint: () => readCheckpoint(username, groupId, checkpointHint),
		policy: {
			maxDepth,
			maxMs,
			anchorTypes: PERMISSION_ANCHOR_TYPES,
		},
		sanitize: stripDagEventLocalExtensions,
	})
}
