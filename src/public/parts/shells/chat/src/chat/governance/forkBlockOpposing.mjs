/**
 * 【文件】governance/forkBlockOpposing.mjs
 * 【职责】采纳某 DAG tip 后，对立分支上治理授权类事件签发者批量写入 blocklist。
 * 【原理】computeDagTipIdsFromEvents 枚举 tips；ancestorClosureFromTip 收集 GOVERNANCE_AUTHZ_TYPES 发送者 pubKeyHash。
 * 【关联】blocklist addDenylistEntry、governance_branch；fork 后用户确认选支。
 */
import { readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'
import { addDenylistEntry } from 'npm:@steve02081504/fount-p2p/node/denylist'
import {
	ancestorClosureFromTip,
	computeDagTipIdsFromEvents,
} from 'npm:@steve02081504/fount-p2p/governance/branch'
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { GOVERNANCE_AUTHZ_TYPES } from '../dag/eventTypes.mjs'
import { eventsPath } from '../lib/paths.mjs'

/**
 * 纯逻辑：从对立 DAG 分支收集治理事件签发者 / 目标 pubKeyHash（不含自身、不触 I/O）。
 * @param {object[]} events 群全量事件
 * @param {string} acceptedTipId 本节点采纳的叶 id（须为当前某个 tip）
 * @param {string} selfPubKeyHash 本节点成员 pubKeyHash（从结果中排除自身）
 * @returns {string[]} 应拉黑的 pubKeyHash 列表（去重、已排除自身）
 */
export function computeOpposingForkBlockTargets(events, acceptedTipId, selfPubKeyHash) {
	const tip = String(acceptedTipId || '').trim().toLowerCase()
	if (!isHex64(tip)) throw new Error('acceptedTipId must be 64 hex chars')

	const byId = new Map(events.filter(event => event?.id).map(event => [String(event.id), event]))

	const tips = computeDagTipIdsFromEvents(events)
	if (!tips.includes(tip)) throw new Error('acceptedTipId is not a current DAG tip')

	// 被采纳分支的因果闭包属于共享/已认可历史，不应拉黑（含创世治理事件、共同祖先）。
	const acceptedClosure = ancestorClosureFromTip(tip, byId)
	const self = String(selfPubKeyHash || '').trim().toLowerCase()
	const targets = new Set()

	for (const otherTip of tips) {
		if (otherTip === tip) continue
		for (const eventId of ancestorClosureFromTip(otherTip, byId)) {
			if (acceptedClosure.has(eventId)) continue
			const event = byId.get(eventId)
			if (!event || !GOVERNANCE_AUTHZ_TYPES.has(event.type)) continue
			const sender = String(event.sender || '').trim().toLowerCase()
			if (isHex64(sender) && sender !== self) targets.add(sender)
			const targetHash = String(event.content?.targetPubKeyHash || '').trim().toLowerCase()
			if (isHex64(targetHash) && targetHash !== self) targets.add(targetHash)
		}
	}

	return [...targets]
}

/**
 * 从对立 DAG 分支收集治理事件签发者并拉黑。
 * @param {string} username 本节点用户
 * @param {string} groupId 群 ID
 * @param {string} acceptedTipId 本节点采纳的叶 id
 * @param {string} selfPubKeyHash 本节点成员 pubKeyHash（从拉黑列表中排除自身）
 * @returns {Promise<{ blocked: string[] }>} 已拉黑 pubKeyHash 列表
 */
export async function blockOpposingForkBranch(username, groupId, acceptedTipId, selfPubKeyHash) {
	const events = await readJsonl(eventsPath(username, groupId), { sanitize: stripDagEventLocalExtensions })
	const targets = computeOpposingForkBlockTargets(events, acceptedTipId, selfPubKeyHash)

	for (const pubKeyHash of targets)
		await addDenylistEntry({ scope: 'subject', value: pubKeyHash, groupId })

	return { blocked: targets }
}
