/**
 * 逐帖反应投影：like/dislike 签名事件按 (author, postId, reactor) 索引。
 * 聚合物 = 签名事件集合，能隐瞒不能伪造。
 */
import path from 'node:path'

import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { writeJsonAtomic } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { withAsyncMutex } from 'npm:@steve02081504/fount-p2p/utils/async_mutex'
import { createLruMap } from 'npm:@steve02081504/fount-p2p/utils/lru'

import { getUserDictionary } from '../../../../../../server/auth/index.mjs'

import { socialPostKey } from './post_key.mjs'

/**
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {{ target: string, postId: string } | null} 规范化键，非法则 null
 */
export function normalizeReactionTarget(targetEntityHash, postId) {
	const target = String(targetEntityHash || '').trim().toLowerCase()
	const id = normalizeHex64(String(postId || '').trim())
	if (!parseEntityHash(target) || !isHex64(id)) return null
	return { target, postId: id }
}

const REACTION_CACHE_MAX = 512
/** 联邦 RPC 单批反应上限 */
export const REACTION_PULL_BATCH = 200

/** @typedef {{ kind: 'like' | 'dislike', event: object }} ReactionEntry */
/** @typedef {{ reactors: Record<string, ReactionEntry> }} ReactionIndex */

/** @type {ReturnType<typeof createLruMap<string, ReactionIndex>>} */
const reactionCache = createLruMap(REACTION_CACHE_MAX)

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {string} 投影文件路径
 */
export function reactionIndexPath(username, targetEntityHash, postId) {
	const normalized = normalizeReactionTarget(targetEntityHash, postId)
	if (!normalized) throw new Error('invalid reaction target')
	return path.join(
		getUserDictionary(username),
		'shells/social/reaction_index',
		normalized.target,
		`${normalized.postId}.json`,
	)
}

/**
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {string} 缓存键
 */
function reactionCacheKey(targetEntityHash, postId) {
	return socialPostKey(targetEntityHash, postId)
}

/**
 * @param {object | null | undefined} raw 磁盘数据
 * @returns {ReactionIndex} 规范化投影
 */
function normalizeReactionIndex(raw) {
	return { reactors: raw?.reactors && typeof raw.reactors === 'object' ? raw.reactors : {} }
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {Promise<ReactionIndex>} 反应投影
 */
export async function readReactionIndex(username, targetEntityHash, postId) {
	const ids = normalizeReactionTarget(targetEntityHash, postId)
	if (!ids) return { reactors: {} }
	const key = reactionCacheKey(ids.target, ids.postId)
	const cached = reactionCache.get(key)
	if (cached) {
		reactionCache.touch(key, cached)
		return cached
	}
	const { readFile } = await import('node:fs/promises')
	try {
		const raw = JSON.parse(await readFile(reactionIndexPath(username, ids.target, ids.postId), 'utf8'))
		const normalized = normalizeReactionIndex(raw)
		reactionCache.touch(key, normalized)
		return normalized
	}
	catch (err) {
		if (err?.code !== 'ENOENT') throw err
		const empty = { reactors: {} }
		reactionCache.touch(key, empty)
		return empty
	}
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @param {Record<string, ReactionEntry>} reactors reactor → 条目
 * @returns {Promise<void>}
 */
async function writeReactionIndex(username, targetEntityHash, postId, reactors) {
	const key = reactionCacheKey(targetEntityHash, postId)
	const payload = { reactors }
	const { mkdir } = await import('node:fs/promises')
	await mkdir(path.dirname(reactionIndexPath(username, targetEntityHash, postId)), { recursive: true })
	await writeJsonAtomic(reactionIndexPath(username, targetEntityHash, postId), payload)
	reactionCache.touch(key, payload)
}

/**
 * 写入或清除反应者条目。
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @param {string} reactorEntityHash 反应者
 * @param {ReactionEntry | null} entry null = 删除
 * @returns {Promise<void>}
 */
export async function upsertReaction(username, targetEntityHash, postId, reactorEntityHash, entry) {
	const ids = normalizeReactionTarget(targetEntityHash, postId)
	if (!ids) return
	const reactor = String(reactorEntityHash || '').trim().toLowerCase()
	if (!parseEntityHash(reactor)) return
	const mutexKey = socialPostKey(ids.target, ids.postId)
	await withAsyncMutex(`reaction-index:${mutexKey}`, async () => {
		const current = await readReactionIndex(username, ids.target, ids.postId)
		const reactors = { ...current.reactors }
		if (entry) reactors[reactor] = entry
		else delete reactors[reactor]
		await writeReactionIndex(username, ids.target, ids.postId, reactors)
	})
}

/**
 * like/dislike/unlike/undislike 落盘后更新投影。
 * @param {string} replicaUsername replica 登录名
 * @param {string} timelineOwnerEntityHash 反应者时间线 owner
 * @param {object} event 签名事件
 * @returns {Promise<void>}
 */
export async function projectReactionFromTimelineEvent(replicaUsername, timelineOwnerEntityHash, event) {
	const type = event?.type
	if (!['like', 'unlike', 'dislike', 'undislike'].includes(type)) return
	const ids = normalizeReactionTarget(event.content?.targetEntityHash, event.content?.targetPostId)
	if (!ids) return
	const reactor = String(timelineOwnerEntityHash || '').trim().toLowerCase()
	if (!parseEntityHash(reactor)) return
	const { loadTaste } = await import('../taste/store.mjs')
	const taste = await loadTaste(replicaUsername, reactor)
	if (taste.privacy.publishReactions === false) {
		// 私密反应：确保不残留公开投影
		if (type === 'unlike' || type === 'undislike' || type === 'like' || type === 'dislike')
			await upsertReaction(replicaUsername, ids.target, ids.postId, reactor, null)
		return
	}
	if (type === 'like')
		await upsertReaction(replicaUsername, ids.target, ids.postId, reactor, { kind: 'like', event })
	else if (type === 'dislike')
		await upsertReaction(replicaUsername, ids.target, ids.postId, reactor, { kind: 'dislike', event })
	else
		await upsertReaction(replicaUsername, ids.target, ids.postId, reactor, null)
}

/**
 * 按 reactor 排序分页返回签名反应事件。
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @param {string | null | undefined} afterReactor 游标（上一批末 reactor）
 * @param {number} [limit=REACTION_PULL_BATCH] 上限
 * @returns {Promise<object[]>} 签名事件列表
 */
export async function listReactionEvents(username, targetEntityHash, postId, afterReactor, limit = REACTION_PULL_BATCH) {
	const ids = normalizeReactionTarget(targetEntityHash, postId)
	if (!ids) return []
	const { reactors } = await readReactionIndex(username, ids.target, ids.postId)
	const keys = Object.keys(reactors).sort()
	let start = 0
	if (afterReactor) {
		const cursor = String(afterReactor).trim().toLowerCase()
		if (!parseEntityHash(cursor)) return []
		const idx = keys.findIndex(key => key === cursor)
		start = idx >= 0 ? idx + 1 : 0
	}
	const batch = Math.min(Math.max(Number(limit) || REACTION_PULL_BATCH, 1), REACTION_PULL_BATCH)
	return keys.slice(start, start + batch).map(key => reactors[key].event)
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {Promise<{ likes: string[], dislikes: string[] }>} 反应者 entityHash 列表
 */
export async function summarizeReactions(username, targetEntityHash, postId) {
	const ids = normalizeReactionTarget(targetEntityHash, postId)
	if (!ids) return { likes: [], dislikes: [] }
	const { reactors } = await readReactionIndex(username, ids.target, ids.postId)
	/** @type {string[]} */
	const likes = []
	/** @type {string[]} */
	const dislikes = []
	for (const [reactor, entry] of Object.entries(reactors))
		if (entry.kind === 'like') likes.push(reactor)
		else if (entry.kind === 'dislike') dislikes.push(reactor)
	return { likes, dislikes }
}
