/**
 * 经 TrustGraph 拉取某帖的签名反应事件，验签并入本地投影。
 */
import { ingestRemoteTimelineEvent } from '../../timeline/sync.mjs'
import { timelineGroupId } from '../namespace.mjs'
import { collectSocialRpcMerged } from '../rpc/wire.mjs'

import { REACTION_PULL_BATCH } from './index.mjs'

const REACTION_PULL_MAX_ROUNDS = 8

/**
 * @param {object} event 签名反应事件
 * @returns {string | null} 反应者 entityHash（时间线 owner）
 */
function reactorFromReactionEvent(event) {
	const expectedPrefix = 'social-timeline:'
	const groupId = String(event?.groupId || '')
	if (!groupId.startsWith(expectedPrefix)) return null
	const hash = groupId.slice(expectedPrefix.length).toLowerCase()
	return hash.length === 128 ? hash : null
}

/**
 * 拉取并导入某帖的 like/dislike 签名事件。
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {Promise<{ attempted: number, imported: number }>} 同步统计
 */
export async function pullPostReactions(username, targetEntityHash, postId) {
	const target = String(targetEntityHash).toLowerCase()
	const id = String(postId).trim()
	let afterReactor = null
	let imported = 0
	let attempted = 0

	for (let round = 0; round < REACTION_PULL_MAX_ROUNDS; round++) {
		const { data: responses, errors } = await collectSocialRpcMerged(username, {
			type: 'social_reaction_pull_request',
			targetEntityHash: target,
			postId: id,
			afterReactor,
			limit: REACTION_PULL_BATCH,
		}, 3000, 8)
		if (errors.length)
			console.warn('social: reaction pull neighbor errors', { targetEntityHash: target, postId: id, count: errors.length })

		/** @type {object[]} */
		const batch = []
		for (const row of responses)
			for (const event of row.events || [])
				batch.push(event)

		if (!batch.length) break
		attempted += batch.length

		/** @type {string[]} */
		const reactorsThisRound = []
		for (const event of batch) {
			const reactor = reactorFromReactionEvent(event)
			if (!reactor) continue
			if (event.groupId !== timelineGroupId(reactor)) continue
			if (!await ingestRemoteTimelineEvent(username, reactor, event)) continue
			imported++
			reactorsThisRound.push(reactor)
		}
		if (!reactorsThisRound.length) break
		reactorsThisRound.sort()
		const nextCursor = reactorsThisRound[reactorsThisRound.length - 1]
		if (afterReactor && nextCursor <= afterReactor) break
		afterReactor = nextCursor
		if (batch.length < REACTION_PULL_BATCH) break
	}

	return { attempted, imported }
}
