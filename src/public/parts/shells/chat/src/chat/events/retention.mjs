/**
 * 【文件】`events/retention.mjs` — DAG 事件流保留与裁剪（§7.1）。
 * 【职责】按群设置裁剪 `events.jsonl`，保留权限锚点与 checkpoint 可达后缀。
 */
import { readFile } from 'node:fs/promises'

import { stripDagEventLocalExtensions } from '../../../../../../../scripts/p2p/dag/strip_extensions.mjs'
import { enforceDagRetention } from '../../../../../../../scripts/p2p/timeline/retention_runner.mjs'
import { PERMISSION_ANCHOR_TYPES } from '../dag/eventTypes.mjs'
import { eventsPath, snapshotPath } from '../lib/paths.mjs'

export async function enforceEventRetention(username, groupId, checkpointHint = null, groupSettings = {}) {
	const eventsFilePath = eventsPath(username, groupId)
	const maxDepth = Math.max(256, Number(groupSettings.eventRetentionDepth) || 200_000)
	const maxMs = Math.max(3_600_000, Number(groupSettings.eventRetentionMs) || 365 * 24 * 3600 * 1000)
	return enforceDagRetention({
		eventsFilePath,
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
