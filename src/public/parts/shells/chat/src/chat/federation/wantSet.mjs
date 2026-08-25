/**
 * 联邦 catchup 待补 id 集合计算（纯函数）：远端 tip ∪ 本地悬挂父 ∪ 显式 extraWantIds 的并集去重。
 */
import { sortedPrevEventIds } from 'npm:@steve02081504/fount-p2p/dag/index'

import { EVENT_ID_HEX } from './registry.mjs'

/**
 * 计算本轮 gossip 应向邻居索要的缺失事件 id 集合。
 * 显式 extraWantIds 每轮都并入（而非仅首轮）：首轮若被 want-ids 限速/链路抖动丢弃，
 * 后续轮仍要持续定向索要，否则该事件在本轮 catchup 内将永远不再被请求。
 * @param {Iterable<string>} remoteTips 远端 tip id 列表
 * @param {Map<string, object>} byId 本地 events.jsonl 的 id→事件
 * @param {object[]} deferredRows pending_ingest / quarantine 延迟桶内事件行
 * @param {Set<string>} locallyKnown 归档/meta/checkpoint 等已见证 id
 * @param {string[]} [extraWantIds] 显式索要 id 列表
 * @returns {string[]} 去重后的待补 id（祖先闭包）
 */
export function computeCatchupWantSet(remoteTips, byId, deferredRows, locallyKnown, extraWantIds) {
	const wantSet = new Set()
	/**
	 * @param {string} candidateId 候选缺失 id
	 * @returns {boolean} 是否仍需向邻居索要
	 */
	const stillNeed = candidateId => !byId.has(candidateId) && !locallyKnown.has(candidateId)
	for (const tipId of remoteTips)
		if (stillNeed(tipId)) wantSet.add(tipId)
	for (const event of byId.values())
		for (const parentId of sortedPrevEventIds(event.prev_event_ids))
			if (stillNeed(parentId)) wantSet.add(parentId)
	for (const row of deferredRows)
		for (const parentId of sortedPrevEventIds(row?.event?.prev_event_ids))
			if (stillNeed(parentId)) wantSet.add(parentId)
	for (const eventId of extraWantIds || []) {
		const id = eventId
		if (EVENT_ID_HEX.test(id) && stillNeed(id)) wantSet.add(id)
	}
	return [...wantSet]
}
