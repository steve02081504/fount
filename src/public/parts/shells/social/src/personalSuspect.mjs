import { applySocialSuspectReputationSignal } from '../../../../../scripts/p2p/reputation.mjs'
import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../../../../server/p2p_server/operator_identity.mjs'

import { commitTimelineEvent } from './timeline/append.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'

/**
 * 以指定实体公开怀疑或解除怀疑（联邦时间线事件 + 信誉传导）。
 * @param {string} username replica
 * @param {string} actingEntityHash 发起方实体
 * @param {string} targetEntityHash 目标实体
 * @param {boolean} suspect true=怀疑
 * @returns {Promise<string[]>} 物化后的公开怀疑名单
 */
export async function setPersonalSuspect(username, actingEntityHash, targetEntityHash, suspect) {
	const actor = String(actingEntityHash || '').trim().toLowerCase()
	const target = String(targetEntityHash || '').trim().toLowerCase()
	await commitTimelineEvent(username, actor, {
		type: suspect ? 'suspect' : 'unsuspect',
		content: { targetEntityHash: target },
	})
	const view = await getTimelineMaterialized(username, actor)
	const operator = await resolveOperatorEntityHash(username)
	const selfTrust = operator?.toLowerCase() === actor
	await applySocialSuspectReputationSignal({
		followerEntityHash: actor,
		targetEntityHash: target,
		action: suspect ? 'suspect' : 'unsuspect',
		selfTrust,
	})
	return view.suspected || []
}

/**
 * 时间线 suspect/unsuspect 入站后同步信誉（关注者视角）。
 * @param {string} username replica
 * @param {string} ownerEntityHash 时间线 owner
 * @param {object} event suspect/unsuspect 事件
 * @param {Set<string>} followedEntities 本机关注的实体（含 operator 自身）
 * @returns {Promise<void>}
 */
export async function handleInboundPersonalSuspectEvent(username, ownerEntityHash, event, followedEntities) {
	const owner = String(ownerEntityHash || '').trim().toLowerCase()
	if (!followedEntities.has(owner)) return
	const target = String(event?.content?.targetEntityHash || '').trim().toLowerCase()
	if (!target) return
	await applySocialSuspectReputationSignal({
		followerEntityHash: owner,
		targetEntityHash: target,
		action: event.type === 'suspect' ? 'suspect' : 'unsuspect',
		selfTrust: false,
	})
}
