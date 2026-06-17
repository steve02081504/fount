/**
 * 【文件】`dag/wal.mjs` — events 与 snapshot 的 WAL 一致性校验。
 * 【职责】验证 `checkpoint_event_id` 是否存在于事件流且仍为当前 DAG tip；不一致时触发全量重放修复。
 * 【原理】WAL（Write-Ahead Log 思想）要求先持久化事件再更新快照；本模块在物化前比对 checkpoint 锚点与 `events.jsonl` 实际 tip 集合，防止崩溃导致快照超前或滞后。
 * 【数据结构】返回 `{ ok, reason?, forceFullReplay? }`；`checkpoint` 含 `checkpoint_event_id`、`dag_tip_ids`。
 * 【关联】`materialize.mjs`、`storage.mjs`、`../lib/paths.mjs`。
 */
import { isAdoptedBaseAuthoritative, isSignedBaseCheckpoint } from '../../../../../../../scripts/p2p/checkpoint.mjs'
import { readJsonl } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { computeDagTipIdsFromEvents, hasDanglingParents } from '../../../../../../../scripts/p2p/governance_branch.mjs'
import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { stripDagEventLocalExtensions } from '../../../../../../../scripts/p2p/dag/strip_extensions.mjs'
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
	const rows = events ?? await readJsonl(eventsPath(username, groupId), { sanitize: stripDagEventLocalExtensions })
	if (!checkpoint) return { ok: true }
	const tipId = String(checkpoint.checkpoint_event_id || '').trim().toLowerCase()
	if (!tipId) return { ok: true }
	if (!isHex64(tipId))
		return { ok: false, reason: 'checkpoint_event_id invalid', forceFullReplay: true }
	if (!rows.length)
		return { ok: false, reason: 'checkpoint without events', forceFullReplay: true }
	const anchorInEvents = rows.some(row => String(row.id || '').trim().toLowerCase() === tipId)
	const tips = computeDagTipIdsFromEvents(rows).map(t => String(t).trim().toLowerCase())
	// 采纳的 owner 签名基态 checkpoint 在联邦 catch-up 全周期内保持权威，不得 forceFullReplay：
	//   · 锚点尚未被 gossip 拉回 events
	//   · DAG 仍有悬挂父（有叶无链）
	//   · 锚点已拉回但仍非当前叶
	//   · checkpoint.dag_tip_ids 与本地叶集合未对齐（catch-up 常态）
	// 以上均为「未追平」中间态，全量重放会把基态 active 成员滤没。退出条件由
	// isAdoptedBaseAuthoritative 给出：本地叶与 dag_tip_ids 完全对齐时返回 false，走下方常规校验。
	if (isAdoptedBaseAuthoritative(checkpoint, tips)
		|| (isSignedBaseCheckpoint(checkpoint) && hasDanglingParents(rows)))
		return { ok: true }

	if (!anchorInEvents)
		return {
			ok: false,
			reason: 'checkpoint_event_id not found in events.jsonl',
			forceFullReplay: true,
		}
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
