import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { createPostScopedJsonStore, normalizePostTarget } from '../postScopedJsonStore.mjs'

const store = createPostScopedJsonStore({
	dirName: 'poll_tally',
	mutexPrefix: 'poll-tally',
	/**
	 * @returns {{ votes: Record<string, { choices: number[] }>, tally: Record<string, number> }} 空 tally
	 */
	empty: () => ({ votes: {}, tally: {} }),
	/**
	 * @param {object | null | undefined} raw 磁盘 tally
	 * @returns {{ votes: Record<string, { choices: number[] }>, tally: Record<string, number> }} 规范化
	 */
	normalize: raw => ({ votes: raw?.votes || {}, tally: raw?.tally || {} }),
})

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {string} tally 文件路径
 */
export function pollTallyPath(username, targetEntityHash, postId) {
	return store.filePath(username, targetEntityHash, postId)
}

/**
 * @param {Record<string, { choices: number[] }>} votes voter → choices
 * @returns {Record<string, number>} 选项计数
 */
export function computePollTallyFromVotes(votes) {
	/** @type {Record<string, number>} */
	const tally = {}
	for (const row of Object.values(votes))
		for (const idx of row?.choices || [])
			tally[String(idx)] = (tally[String(idx)] || 0) + 1
	return tally
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {Promise<{ votes: Record<string, { choices: number[] }>, tally: Record<string, number> }>} tally 投影
 */
export async function readPollTally(username, targetEntityHash, postId) {
	return store.read(username, targetEntityHash, postId)
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @param {Record<string, { choices: number[] }>} votes voter → choices
 * @returns {Promise<void>}
 */
async function writePollTally(username, targetEntityHash, postId, votes) {
	await store.write(username, targetEntityHash, postId, {
		votes,
		tally: computePollTallyFromVotes(votes),
	})
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @param {string} voterEntityHash 投票者
 * @param {number[]} choices 选项下标
 * @returns {Promise<void>}
 */
export async function upsertPollVote(username, targetEntityHash, postId, voterEntityHash, choices) {
	const ids = normalizePostTarget(targetEntityHash, postId)
	if (!ids) return
	const voter = String(voterEntityHash || '').trim().toLowerCase()
	if (!parseEntityHash(voter)) return
	await store.withMutex(ids.target, ids.postId, async () => {
		const current = await store.read(username, ids.target, ids.postId)
		await writePollTally(username, ids.target, ids.postId, {
			...current.votes,
			[voter]: { choices: [...choices] },
		})
	})
}

/**
 * poll_vote 事件落盘后更新 tally 投影。
 * @param {string} replicaUsername replica 登录名
 * @param {string} timelineOwnerEntityHash 投票者时间线 owner
 * @param {object} event 签名事件
 * @returns {Promise<void>}
 */
export async function projectPollVoteFromTimelineEvent(replicaUsername, timelineOwnerEntityHash, event) {
	if (event.type !== 'poll_vote') return
	const ids = normalizePostTarget(event.content?.targetEntityHash, event.content?.targetPostId)
	const choices = event.content?.choices
	if (!ids || !Array.isArray(choices)) return
	await upsertPollVote(replicaUsername, ids.target, ids.postId, timelineOwnerEntityHash, choices)
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {Promise<Record<string, number>>} 选项计数
 */
export async function listPollTally(username, targetEntityHash, postId) {
	const { tally } = await readPollTally(username, targetEntityHash, postId)
	return tally
}
