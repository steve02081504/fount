/**
 * 经 TrustGraph 拉取某帖的签名补充信息事件。
 */
import { ingestRemoteTimelineEvent } from '../../timeline/sync.mjs'
import { timelineGroupId } from '../namespace.mjs'
import { collectSocialRpcMerged } from '../rpc/wire.mjs'

import { NOTE_PULL_BATCH } from './index.mjs'

const NOTE_PULL_MAX_ROUNDS = 8

/**
 * @param {object} event 签名事件
 * @returns {string | null} 作者 entityHash
 */
function authorFromNoteEvent(event) {
	const expectedPrefix = 'social-timeline:'
	const groupId = String(event?.groupId || '')
	if (!groupId.startsWith(expectedPrefix)) return null
	const hash = groupId.slice(expectedPrefix.length).toLowerCase()
	return hash.length === 128 ? hash : null
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {Promise<{ attempted: number, imported: number }>} 同步统计
 */
export async function pullPostNotes(username, targetEntityHash, postId) {
	const target = String(targetEntityHash).toLowerCase()
	const id = String(postId).trim()
	let afterAuthor = null
	let imported = 0
	let attempted = 0

	for (let round = 0; round < NOTE_PULL_MAX_ROUNDS; round++) {
		const { data: responses, errors } = await collectSocialRpcMerged(username, {
			type: 'social_note_pull_request',
			targetEntityHash: target,
			postId: id,
			afterAuthor,
			limit: NOTE_PULL_BATCH,
		}, 3000, 8)
		if (errors.length)
			console.warn('social: note pull neighbor errors', { targetEntityHash: target, postId: id, count: errors.length })

		/** @type {object[]} */
		const batch = []
		for (const row of responses)
			for (const event of row.events || [])
				batch.push(event)

		if (!batch.length) break
		attempted += batch.length

		/** @type {string[]} */
		const authorsThisRound = []
		for (const event of batch) {
			const author = authorFromNoteEvent(event)
			if (!author) continue
			if (event.groupId !== timelineGroupId(author)) continue
			if (!await ingestRemoteTimelineEvent(username, author, event)) continue
			imported++
			authorsThisRound.push(author)
		}
		if (!authorsThisRound.length) break
		authorsThisRound.sort()
		const nextCursor = authorsThisRound[authorsThisRound.length - 1]
		if (afterAuthor && nextCursor <= afterAuthor) break
		afterAuthor = nextCursor
		if (batch.length < NOTE_PULL_BATCH) break
	}

	return { attempted, imported }
}
