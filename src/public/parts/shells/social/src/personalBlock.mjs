import { rebuildPersonalBlockIndex } from '../../../../../scripts/p2p/personal_block.mjs'
import { applyBlockReputationSignal } from '../../../../../scripts/p2p/reputation_store.mjs'
import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../../../../server/p2p_server/operator_identity.mjs'

import { commitTimelineEvent } from './timeline/append.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'

/**
 * 以指定实体公开拉黑或解除拉黑（联邦时间线事件 + 本地索引 + 信誉）。
 * @param {string} username replica
 * @param {string} actingEntityHash 发起方实体
 * @param {string} targetEntityHash 目标实体
 * @param {boolean} block true=拉黑
 * @returns {Promise<string[]>} 物化后的公开拉黑名单
 */
export async function setPersonalBlock(username, actingEntityHash, targetEntityHash, block) {
	const actor = String(actingEntityHash || '').trim().toLowerCase()
	const target = String(targetEntityHash || '').trim().toLowerCase()
	await commitTimelineEvent(username, actor, {
		type: block ? 'block' : 'unblock',
		content: { targetEntityHash: target },
	})
	const view = await getTimelineMaterialized(username, actor)
	await rebuildPersonalBlockIndex(actor, view.blocked || [])
	const operator = await resolveOperatorEntityHash(username)
	const selfTrust = operator?.toLowerCase() === actor
	await applyBlockReputationSignal({
		followerEntityHash: actor,
		targetEntityHash: target,
		action: block ? 'block' : 'unblock',
		selfTrust,
	})
	return view.blocked || []
}

/**
 * 时间线 block/unblock 入站后同步索引与信誉（关注者视角）。
 * @param {string} username replica
 * @param {string} ownerEntityHash 时间线 owner
 * @param {object} event block/unblock 事件
 * @param {Set<string>} followedEntities 本机关注的实体（含 operator 自身）
 * @returns {Promise<void>}
 */
export async function handleInboundPersonalBlockEvent(username, ownerEntityHash, event, followedEntities) {
	const owner = String(ownerEntityHash || '').trim().toLowerCase()
	if (!followedEntities.has(owner)) return
	const target = String(event?.content?.targetEntityHash || '').trim().toLowerCase()
	if (!target) return
	const view = await getTimelineMaterialized(username, owner)
	await rebuildPersonalBlockIndex(owner, view.blocked || [])
	await applyBlockReputationSignal({
		followerEntityHash: owner,
		targetEntityHash: target,
		action: event.type === 'block' ? 'block' : 'unblock',
		selfTrust: false,
	})
}
