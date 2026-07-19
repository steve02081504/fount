/**
 * 逐帖反应投影：like/dislike 签名事件按 (author, postId, reactor) 索引。
 * 聚合物 = 签名事件集合，能隐瞒不能伪造。
 */
import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { createPostScopedJsonStore, normalizePostTarget } from '../postScopedJsonStore.mjs'

/** 联邦 RPC 单批反应上限 */
export const REACTION_PULL_BATCH = 200

/** @typedef {{ kind: 'like' | 'dislike', event: object }} ReactionEntry */
/** @typedef {{ reactors: Record<string, ReactionEntry> }} ReactionIndex */

/**
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {{ target: string, postId: string } | null} 规范化键，非法则 null
 */
export const normalizeReactionTarget = normalizePostTarget

const store = createPostScopedJsonStore({
	dirName: 'reaction_index',
	mutexPrefix: 'reaction-index',
	/**
	 * @returns {ReactionIndex} 空投影
	 */
	empty: () => ({ reactors: {} }),
	/**
	 * @param {object | null | undefined} raw 磁盘数据
	 * @returns {ReactionIndex} 规范化投影
	 */
	normalize: raw => ({ reactors: raw?.reactors && typeof raw.reactors === 'object' ? raw.reactors : {} }),
})

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {string} 投影文件路径
 */
export function reactionIndexPath(username, targetEntityHash, postId) {
	return store.filePath(username, targetEntityHash, postId)
}

/**
 * @param {string} username replica
 * @param {string} targetEntityHash 帖作者
 * @param {string} postId 帖 id
 * @returns {Promise<ReactionIndex>} 反应投影
 */
export async function readReactionIndex(username, targetEntityHash, postId) {
	return store.read(username, targetEntityHash, postId)
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
	const ids = normalizePostTarget(targetEntityHash, postId)
	if (!ids) return
	const reactor = String(reactorEntityHash || '').trim().toLowerCase()
	if (!parseEntityHash(reactor)) return
	await store.withMutex(ids.target, ids.postId, async () => {
		const current = await store.read(username, ids.target, ids.postId)
		const reactors = { ...current.reactors }
		if (entry) reactors[reactor] = entry
		else delete reactors[reactor]
		await store.write(username, ids.target, ids.postId, { reactors })
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
	const ids = normalizePostTarget(event.content?.targetEntityHash, event.content?.targetPostId)
	if (!ids) return
	const reactor = String(timelineOwnerEntityHash || '').trim().toLowerCase()
	if (!parseEntityHash(reactor)) return
	const { loadTaste } = await import('../../taste/store.mjs')
	const taste = await loadTaste(replicaUsername, reactor)
	if (taste.privacy.publishReactions === false) {
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
	const ids = normalizePostTarget(targetEntityHash, postId)
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
	const ids = normalizePostTarget(targetEntityHash, postId)
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
