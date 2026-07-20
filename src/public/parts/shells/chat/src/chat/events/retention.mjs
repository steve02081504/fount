/**
 * 【文件】`events/retention.mjs` — DAG 事件流保留与裁剪（§7.1）。
 * 【职责】按群设置裁剪 `events.jsonl`，保留权限锚点与 checkpoint 可达后缀。
 */
import { readFile } from 'node:fs/promises'

import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'
import { enforceDagRetention } from 'npm:@steve02081504/fount-p2p/timeline/retention_runner'

import { PERMISSION_ANCHOR_TYPES } from '../dag/eventTypes.mjs'
import { eventsPath, snapshotPath } from '../lib/paths.mjs'

/**
 * 按群设置裁剪 `events.jsonl`，保留权限锚点与 checkpoint 可达后缀。
 * @param {string} username 登录名
 * @param {string} groupId 群 id
 * @param {object | null} [checkpointHint] 已有 snapshot 检查点，省略时从磁盘读取
 * @param {object} [groupSettings] 群设置（`eventRetentionDepth` / `eventRetentionMs`）
 * @returns {Promise<{ pruned: boolean, kept: number, dropped: number }>} 裁剪统计
 */
export async function enforceEventRetention(username, groupId, checkpointHint = null, groupSettings = {}) {
	const eventsFilePath = eventsPath(username, groupId)
	const maxDepth = Math.max(256, Number(groupSettings.eventRetentionDepth) || 200_000)
	const maxMs = Math.max(3_600_000, Number(groupSettings.eventRetentionMs) || 365 * 24 * 3600 * 1000)
	return enforceDagRetention({
		eventsFilePath,
		/**
		 * @returns {Promise<object | null>} snapshot 检查点；缺失或解析失败时 null
		 */
		readCheckpoint: async () => {
			if (checkpointHint) return checkpointHint
			try {
				return JSON.parse(await readFile(snapshotPath(username, groupId), 'utf8'))
			}
			catch {
				return null
			}
		},
		policy: {
			maxDepth,
			maxMs,
			anchorTypes: PERMISSION_ANCHOR_TYPES,
		},
		sanitize: stripDagEventLocalExtensions,
	})
}
