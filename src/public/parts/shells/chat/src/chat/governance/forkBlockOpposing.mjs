/**
 * 【文件】governance/forkBlockOpposing.mjs
 * 【职责】采纳某 DAG tip 后，对立分支上治理授权类事件签发者批量写入 blocklist。
 * 【原理】computeDagTipIdsFromEvents 枚举 tips；ancestorClosureFromTip 收集 GOVERNANCE_AUTHZ_TYPES 发送者 pubKeyHash。
 * 【关联】blocklist addBlocklistEntry、governance_branch；fork 后用户确认选支。
 */
import { addBlocklistEntry } from '../../../../../../../scripts/p2p/blocklist.mjs'
import { readJsonl } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { GOVERNANCE_AUTHZ_TYPES } from '../../../../../../../scripts/p2p/event_types.mjs'
import {
	ancestorClosureFromTip,
	computeDagTipIdsFromEvents,
} from '../../../../../../../scripts/p2p/governance_branch.mjs'
import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { stripDagEventLocalExtensions } from '../../../../../../../scripts/p2p/dag/strip_extensions.mjs'
import { eventsPath } from '../lib/paths.mjs'

/**
 * 从对立 DAG 分支收集治理事件签发者并拉黑。
 * @param {string} username 本节点用户
 * @param {string} groupId 群 ID
 * @param {string} acceptedTipId 本节点采纳的叶 id
 * @returns {Promise<{ blocked: string[] }>} 已拉黑 pubKeyHash 列表
 */
export async function blockOpposingForkBranch(username, groupId, acceptedTipId) {
	const tip = String(acceptedTipId || '').trim().toLowerCase()
	if (!isHex64(tip)) throw new Error('acceptedTipId must be 64 hex chars')

	const events = await readJsonl(eventsPath(username, groupId), { sanitize: stripDagEventLocalExtensions })
	const byId = new Map(events.filter(event => event?.id).map(event => [String(event.id), event]))

	const tips = computeDagTipIdsFromEvents(events)
	if (!tips.includes(tip)) throw new Error('acceptedTipId is not a current DAG tip')

	const self = String(username || '').trim().toLowerCase()
	const targets = new Set()

	for (const otherTip of tips) {
		if (otherTip === tip) continue
		for (const eventId of ancestorClosureFromTip(otherTip, byId)) {
			const event = byId.get(eventId)
			if (!event || !GOVERNANCE_AUTHZ_TYPES.has(event.type)) continue
			const sender = String(event.sender || '').trim().toLowerCase()
			if (sender && sender !== self && isHex64(sender)) targets.add(sender)
			const targetHash = String(event.content?.targetPubKeyHash || '').trim().toLowerCase()
			if (isHex64(targetHash) && targetHash !== self) targets.add(targetHash)
		}
	}

	for (const pubKeyHash of targets)
		await addBlocklistEntry( { scope: 'subject', value: pubKeyHash, groupId })

	return { blocked: [...targets] }
}
