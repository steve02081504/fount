import { createHash } from 'node:crypto'

import { computeLocalTipsHash } from '../../../../../../../scripts/p2p/dag/index.mjs'
import { computeDagTipIdsFromEvents } from '../../../../../../../scripts/p2p/governance_branch.mjs'

const BODY_ARCHIVE_TYPES = new Set(['message', 'message_edit'])

/**
 * 拉黑发送者的消息正文不参与存档摘要 hash（§0.5）。
 * @param {object} event DAG 事件
 * @param {Set<string>} blockedSenders 小写 pubKeyHash
 * @returns {object} 摘要用事件视图
 */
function eventViewForArchive(event, blockedSenders) {
	if (!blockedSenders.size || !BODY_ARCHIVE_TYPES.has(event.type)) return event
	const sender = String(event.sender || '').trim().toLowerCase()
	if (!blockedSenders.has(sender)) return event
	return { ...event, content: { archiveBodyRedacted: true, type: event.type } }
}

/**
 * 合并存档摘要：事件条数、末条 id、checkpoint、DAG 叶（§9 want 前握手）。
 * @param {object[]} events 本地 DAG 事件
 * @param {object | null} checkpoint `checkpoint.json` 或 null
 * @param {{ blockedPeers?: string[] }} [options] 拉黑主体省略正文
 * @returns {{ hash: string, eventCount: number, lastEventId: string, checkpointEventId: string, tips: string, tipsHash: string }} 存档摘要
 */
export function computeArchiveSummary(events, checkpoint, options = {}) {
	const blockedSenders = new Set(
		(options.blockedPeers || []).map(id => String(id).trim().toLowerCase()).filter(Boolean),
	)
	const view = blockedSenders.size
		? events.map(event => eventViewForArchive(event, blockedSenders))
		: events
	const eventCount = view.length
	const lastEventId = eventCount ? String(view[eventCount - 1]?.id ?? '') : ''
	const checkpointEventId = checkpoint?.checkpoint_event_id
		? String(checkpoint.checkpoint_event_id)
		: ''
	const tipIds = computeDagTipIdsFromEvents(view)
	const tips = tipIds.join(',')
	const tipsHash = checkpoint?.local_tips_hash
		? String(checkpoint.local_tips_hash)
		: computeLocalTipsHash(tipIds)
	return {
		hash: createHash('sha256').update(JSON.stringify({
			v: 4,
			eventCount,
			lastEventId,
			checkpointEventId,
			tips,
			tipsHash,
			redacted: blockedSenders.size > 0,
		}), 'utf8').digest('hex'),
		eventCount,
		lastEventId,
		checkpointEventId,
		tips,
		tipsHash,
	}
}
