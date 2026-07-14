import path from 'node:path'

import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { writeJsonAtomic } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { withAsyncMutex } from 'npm:@steve02081504/fount-p2p/utils/async_mutex'
import { createLruMap } from 'npm:@steve02081504/fount-p2p/utils/lru'

import { getUserDictionary } from '../../../../../../server/auth/index.mjs'

import { socialPostKey } from './post_key.mjs'

const POLL_TALLY_CACHE_MAX = 512

/** @type {ReturnType<typeof createLruMap<string, object>>} */
const pollTallyCache = createLruMap(POLL_TALLY_CACHE_MAX)

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {string} tally 文件路径
 */
export function pollTallyPath(username, targetEntityHash, postId) {
	return path.join(
		getUserDictionary(username),
		'shells/social/poll_tally',
		targetEntityHash.toLowerCase(),
		`${postId}.json`,
	)
}

/**
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {string} 缓存键
 */
function pollTallyCacheKey(targetEntityHash, postId) {
	return `${targetEntityHash.toLowerCase()}:${postId}`
}

/**
 * @param {object | null | undefined} raw 磁盘 tally
 * @returns {{ votes: Record<string, { choices: number[] }>, tally: Record<string, number> }} 规范化 tally
 */
function normalizePollTally(raw) {
	return { votes: raw?.votes || {}, tally: raw?.tally || {} }
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
	const key = pollTallyCacheKey(targetEntityHash, postId)
	const cached = pollTallyCache.get(key)
	if (cached) {
		pollTallyCache.touch(key, cached)
		return cached
	}
	const { readFile } = await import('node:fs/promises')
	try {
		const raw = JSON.parse(await readFile(pollTallyPath(username, targetEntityHash, postId), 'utf8'))
		const normalized = normalizePollTally(raw)
		pollTallyCache.touch(key, normalized)
		return normalized
	}
	catch (err) {
		if (err?.code !== 'ENOENT') throw err
		const empty = { votes: {}, tally: {} }
		pollTallyCache.touch(key, empty)
		return empty
	}
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @param {Record<string, { choices: number[] }>} votes voter → choices
 * @returns {Promise<void>}
 */
async function writePollTally(username, targetEntityHash, postId, votes) {
	const key = pollTallyCacheKey(targetEntityHash, postId)
	const tally = computePollTallyFromVotes(votes)
	const payload = { votes, tally }
	const { mkdir } = await import('node:fs/promises')
	await mkdir(path.dirname(pollTallyPath(username, targetEntityHash, postId)), { recursive: true })
	await writeJsonAtomic(pollTallyPath(username, targetEntityHash, postId), payload)
	pollTallyCache.touch(key, payload)
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
	const target = targetEntityHash.toLowerCase()
	const voter = voterEntityHash.toLowerCase()
	const mutexKey = socialPostKey(target, postId)
	await withAsyncMutex(`poll-tally:${mutexKey}`, async () => {
		const current = await readPollTally(username, target, postId)
		const votes = { ...current.votes, [voter]: { choices: [...choices] } }
		await writePollTally(username, target, postId, votes)
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
	const targetEntityHash = String(event.content?.targetEntityHash || '').trim().toLowerCase()
	const targetPostId = String(event.content?.targetPostId || '').trim()
	const choices = event.content?.choices
	if (!parseEntityHash(targetEntityHash) || !targetPostId || !Array.isArray(choices)) return
	await upsertPollVote(replicaUsername, targetEntityHash, targetPostId, timelineOwnerEntityHash.toLowerCase(), choices)
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
