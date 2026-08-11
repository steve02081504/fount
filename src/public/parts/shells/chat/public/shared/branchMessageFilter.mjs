/**
 * 按 DAG 分支 tip 过滤频道消息行（分叉时 messages.jsonl 会含各支事件）。
 */
import { ancestorClosureFromTip } from 'https://esm.sh/@steve02081504/fount-p2p/governance/branch'

/**
 * 仅保留落在指定 tip 祖先闭包内的消息行。
 * @param {object[]} lines 频道消息行（含 eventId）
 * @param {string | null | undefined} branchTip 展示用 tip（通常 consensus / localView）
 * @param {Map<string, { id: string, prev_event_ids?: unknown }> | Iterable<object>} eventsOrById DAG 事件或 id→事件
 * @returns {object[]} 过滤后的行；无 tip / 空图时原样返回
 */
export function filterChannelMessageLinesByBranchTip(lines, branchTip, eventsOrById) {
	const tip = branchTip || ''
	if (!tip || !lines?.length) return lines
	const byId = eventsOrById instanceof Map
		? new Map([...eventsOrById].map(([id, event]) => [id, event]))
		: new Map([...eventsOrById].map(event => [event.id, event]))
	if (!byId.size) return lines
	const closure = ancestorClosureFromTip(tip, byId)
	if (!closure.size) return lines
	return lines.filter(line => {
		const id = line?.eventId
		return id && closure.has(id)
	})
}
