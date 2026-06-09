/**
 * 【文件】`dag/wal.mjs` — events 与 snapshot 的 WAL 一致性校验。
 * 【职责】验证 `checkpoint_event_id` 是否存在于事件流且仍为当前 DAG tip；不一致时触发全量重放修复。
 * 【原理】WAL（Write-Ahead Log 思想）要求先持久化事件再更新快照；本模块在物化前比对 checkpoint 锚点与 `events.jsonl` 实际 tip 集合，防止崩溃导致快照超前或滞后。
 * 【数据结构】返回 `{ ok, reason?, forceFullReplay? }`；`checkpoint` 含 `checkpoint_event_id`、`dag_tip_ids`。
 * 【关联】`materialize.mjs`、`storage.mjs`、`../lib/paths.mjs`。
 */
import { readJsonl } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { computeDagTipIdsFromEvents } from '../../../../../../../scripts/p2p/governance_branch.mjs'
import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { sanitizeFederatedEvent } from '../events/wire.mjs'
import { eventsPath, snapshotPath } from '../lib/paths.mjs'


/**
 * 校验 events.jsonl 与 snapshot.checkpoint_event_id 一致性。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {object | null} checkpoint 快照对象
 * @param {object[]} [events] 已读事件行
 * @returns {Promise<{ ok: boolean, reason?: string, forceFullReplay?: boolean }>} WAL 校验结果
 */
export async function verifyEventsSnapshotWAL(username, groupId, checkpoint, events) {
	const rows = events ?? await readJsonl(eventsPath(username, groupId), { sanitize: sanitizeFederatedEvent })
	if (!checkpoint) return { ok: true }
	const tipId = String(checkpoint.checkpoint_event_id || '').trim().toLowerCase()
	if (!tipId) return { ok: true }
	if (!isHex64(tipId))
		return { ok: false, reason: 'checkpoint_event_id invalid', forceFullReplay: true }
	if (!rows.length)
		return { ok: false, reason: 'checkpoint without events', forceFullReplay: true }
	if (!rows.some(row => String(row.id || '').trim().toLowerCase() === tipId))
		return {
			ok: false,
			reason: 'checkpoint_event_id not found in events.jsonl',
			forceFullReplay: true,
		}

	const tips = computeDagTipIdsFromEvents(rows).map(t => String(t).trim().toLowerCase())
	if (!tips.includes(tipId))
		return {
			ok: false,
			reason: 'checkpoint_event_id is not a current DAG tip',
			forceFullReplay: true,
		}

	const snapshotTips = (Array.isArray(checkpoint.dag_tip_ids) ? checkpoint.dag_tip_ids : [])
		.map(t => String(t).trim().toLowerCase())
		.filter(isHex64)
	if (snapshotTips.length && tips.length) {
		const tipSet = new Set(tips)
		if (snapshotTips.length !== tips.length || snapshotTips.some(t => !tipSet.has(t)))
			return {
				ok: false,
				reason: 'checkpoint dag_tip_ids mismatch events tips',
				forceFullReplay: true,
			}
	}

	return { ok: true }
}

/**
 * 读取群快照 JSON。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @returns {Promise<object | null>} 解析后的快照或 null
 */
export async function safeReadSnapshot(username, groupId) {
	try {
		const { readFile } = await import('node:fs/promises')
		return JSON.parse(await readFile(snapshotPath(username, groupId), 'utf8'))
	}
	catch {
		return null
	}
}
