/**
 * 反应图信任加权 Jaccard 聚类 → 本地口味 tag。
 * 点踩为负向证据；所有计数信任加权；禁止裸全局计数。
 */
import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { pickNodeScore } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

import { socialPostKey } from '../federation/post_key.mjs'
import { summarizeReactions } from '../federation/reaction_index.mjs'
import { loadFollowingForActor } from '../following.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'

import { loadTaste, mutateTaste, resolveTasteAlias } from './store.mjs'

const JACCARD_MERGE = 0.45
const SENIORITY_MIN_POSTS = 2
const CLUSTER_STALE_MS = 6 * 60 * 60 * 1000
const MAX_POSTS_SCAN = 400

/**
 * @param {string} entityHash 实体
 * @returns {number} 信任权重 ∈ (0, 1]
 */
function trustWeightOfEntity(entityHash) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return 0
	const score = pickNodeScore(parsed.nodeHash)
	// score 常见约 [-1,1]；映射到 (0.05, 1]
	return Math.max(0.05, Math.min(1, 0.5 + score / 2))
}

/**
 * @param {Map<string, number>} left 加权集合
 * @param {Map<string, number>} right 加权集合
 * @returns {number} 加权 Jaccard
 */
export function weightedJaccard(left, right) {
	if (!left.size || !right.size) return 0
	let inter = 0
	let union = 0
	const keys = new Set([...left.keys(), ...right.keys()])
	for (const key of keys) {
		const a = left.get(key) || 0
		const b = right.get(key) || 0
		inter += Math.min(a, b)
		union += Math.max(a, b)
	}
	return union > 0 ? inter / union : 0
}

/**
 * @param {Map<string, number>} likes 正向
 * @param {Map<string, number>} dislikes 负向
 * @returns {Map<string, number>} 净受众向量（负权夹到 0 后用于 Jaccard）
 */
function audienceVector(likes, dislikes) {
	/** @type {Map<string, number>} */
	const out = new Map()
	for (const [k, w] of likes)
		out.set(k, (out.get(k) || 0) + w)
	for (const [k, w] of dislikes)
		out.set(k, (out.get(k) || 0) - w)
	for (const [k, w] of [...out.entries()])
		if (w <= 0) out.delete(k)
		else out.set(k, w)
	return out
}

/**
 * @param {string} username replica
 * @param {string} entityHash acting
 * @param {Set<string>} following 关注
 * @returns {Promise<Map<string, { likes: Map<string, number>, dislikes: Map<string, number>, selfTags: string[] }>>}
 */
async function collectPostAudiences(username, entityHash, following) {
	/** @type {Map<string, { likes: Map<string, number>, dislikes: Map<string, number>, selfTags: string[] }>} */
	const posts = new Map()

	/**
	 * @param {string} author
	 * @param {string} postId
	 * @returns {{ likes: Map<string, number>, dislikes: Map<string, number>, selfTags: string[] }}
	 */
	function ensure(author, postId) {
		const key = socialPostKey(author, postId)
		let row = posts.get(key)
		if (!row) {
			row = { likes: new Map(), dislikes: new Map(), selfTags: [] }
			posts.set(key, row)
		}
		return row
	}

	const actors = new Set([entityHash, ...following])
	for (const actor of actors) {
		if (!parseEntityHash(actor)) continue
		const view = await getTimelineMaterialized(username, actor)
		const weight = actor === entityHash ? 1 : trustWeightOfEntity(actor) * (following.has(actor) ? 1 : 0.5)
		for (const like of view.likes || []) {
			const target = String(like.content?.targetEntityHash || '').toLowerCase()
			const postId = String(like.content?.targetPostId || '')
			if (!parseEntityHash(target) || !postId) continue
			const row = ensure(target, postId)
			row.likes.set(actor, (row.likes.get(actor) || 0) + weight)
		}
		for (const dislike of view.dislikes || []) {
			const target = String(dislike.content?.targetEntityHash || '').toLowerCase()
			const postId = String(dislike.content?.targetPostId || '')
			if (!parseEntityHash(target) || !postId) continue
			const row = ensure(target, postId)
			row.dislikes.set(actor, (row.dislikes.get(actor) || 0) + weight)
		}
		for (const post of view.posts || []) {
			const tags = Array.isArray(post.content?.tags)
				? post.content.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean)
				: []
			if (tags.length) ensure(actor, post.id).selfTags = tags
		}
	}

	// 合并 reaction_index（可能含推送到达的远距反应）
	for (const [key, row] of [...posts.entries()].slice(0, MAX_POSTS_SCAN)) {
		const [author, postId] = key.split(':')
		if (!author || !postId) continue
		const summary = await summarizeReactions(username, author, postId)
		for (const reactor of summary.likes) {
			if (row.likes.has(reactor)) continue
			const w = trustWeightOfEntity(reactor)
			row.likes.set(reactor, (row.likes.get(reactor) || 0) + w)
		}
		for (const reactor of summary.dislikes) {
			if (row.dislikes.has(reactor)) continue
			const w = trustWeightOfEntity(reactor)
			row.dislikes.set(reactor, (row.dislikes.get(reactor) || 0) + w)
		}
	}

	return posts
}

/**
 * 选簇代表元：出现次数足够的最小 reactor hash（资历门槛防碾磨）。
 * @param {Map<string, number>[]} audiences 各帖净受众
 * @returns {string | null} tag hash
 */
export function pickClusterRepresentative(audiences) {
	/** @type {Map<string, number>} */
	const appear = new Map()
	for (const aud of audiences)
		for (const reactor of aud.keys())
			appear.set(reactor, (appear.get(reactor) || 0) + 1)
	const eligible = [...appear.entries()]
		.filter(([, count]) => count >= SENIORITY_MIN_POSTS)
		.map(([hash]) => hash)
		.sort()
	if (eligible.length) return eligible[0]
	// 退化：取全局最小 reactor，避免空簇
	const all = [...appear.keys()].sort()
	return all[0] || null
}

/**
 * @param {Map<string, Map<string, number>>} postAudiences postKey → audience
 * @returns {Map<string, string>} postKey → tagHash
 */
export function clusterPostsByAudience(postAudiences) {
	const keys = [...postAudiences.keys()]
	/** @type {number[]} */
	const parent = keys.map((_, i) => i)
	/**
	 * @param {number} i
	 * @returns {number}
	 */
	function find(i) {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]]
			i = parent[i]
		}
		return i
	}
	/**
	 * @param {number} a
	 * @param {number} b
	 */
	function union(a, b) {
		const ra = find(a)
		const rb = find(b)
		if (ra !== rb) parent[ra] = rb
	}

	for (let i = 0; i < keys.length; i++)
		for (let j = i + 1; j < keys.length; j++)
			if (weightedJaccard(postAudiences.get(keys[i]), postAudiences.get(keys[j])) >= JACCARD_MERGE)
				union(i, j)

	/** @type {Map<number, string[]>} */
	const groups = new Map()
	for (let i = 0; i < keys.length; i++) {
		const root = find(i)
		if (!groups.has(root)) groups.set(root, [])
		groups.get(root).push(keys[i])
	}

	/** @type {Map<string, string>} */
	const assignment = new Map()
	for (const members of groups.values()) {
		const audiences = members.map(k => postAudiences.get(k))
		const tag = pickClusterRepresentative(audiences)
		if (!tag) continue
		for (const key of members)
			assignment.set(key, tag)
	}
	return assignment
}

/**
 * 重建实体口味表。
 * @param {string} username replica
 * @param {string} entityHash acting
 * @returns {Promise<import('./store.mjs').TasteStore>} 更新后偏好
 */
export async function rebuildTaste(username, entityHash) {
	const actor = String(entityHash).toLowerCase()
	const { following } = await loadFollowingForActor(username, actor)
	const followingSet = new Set([...following].map(h => h.toLowerCase()))
	const raw = await collectPostAudiences(username, actor, followingSet)

	/** @type {Map<string, Map<string, number>>} */
	const audiences = new Map()
	/** @type {Map<string, string[]>} */
	const selfTags = new Map()
	for (const [key, row] of raw) {
		audiences.set(key, audienceVector(row.likes, row.dislikes))
		if (row.selfTags?.length) selfTags.set(key, row.selfTags)
	}

	const assignment = clusterPostsByAudience(audiences)

	const ownView = await getTimelineMaterialized(username, actor)
	/** @type {Map<string, number>} */
	const ownSignal = new Map()
	for (const like of ownView.likes || []) {
		const key = socialPostKey(like.content?.targetEntityHash, like.content?.targetPostId)
		ownSignal.set(key, (ownSignal.get(key) || 0) + 1)
	}
	for (const dislike of ownView.dislikes || []) {
		const key = socialPostKey(dislike.content?.targetEntityHash, dislike.content?.targetPostId)
		ownSignal.set(key, (ownSignal.get(key) || 0) - 1)
	}

	return mutateTaste(username, actor, store => {
		/** @type {Record<string, number>} */
		const tags = { ...store.tags }
		/** @type {Record<string, { tags: string[], selfWeight: number }>} */
		const postTags = { ...store.postTags }

		for (const [key, signal] of ownSignal) {
			const clusterTag = assignment.get(key)
			const declared = selfTags.get(key) || []
			const reactionCount = Math.abs(signal)
			// 自标先验随反应数衰减
			const selfWeight = 1 / (1 + reactionCount)
			/** @type {string[]} */
			const tagList = []
			if (clusterTag) tagList.push(clusterTag)
			for (const t of declared)
				if (!tagList.includes(t)) tagList.push(t)

			postTags[key] = { tags: tagList, selfWeight }

			for (const rawTag of tagList) {
				const canon = resolveTasteAlias(rawTag, store.aliases)
				const isSelf = declared.includes(rawTag) && rawTag !== clusterTag
				const delta = signal * (isSelf ? selfWeight : 1)
				tags[canon] = (tags[canon] || 0) + delta
			}
		}

		store.tags = tags
		store.postTags = postTags
		store.clusteredAt = Date.now()
		return store
	})
}

/**
 * 若偏好表过期则重建。
 * @param {string} username replica
 * @param {string} entityHash acting
 * @returns {Promise<import('./store.mjs').TasteStore>} 偏好
 */
export async function ensureTasteFresh(username, entityHash) {
	const store = await loadTaste(username, entityHash)
	if (Date.now() - store.clusteredAt < CLUSTER_STALE_MS) return store
	return rebuildTaste(username, entityHash)
}

/**
 * 帖与观看者偏好的匹配分（仅正贡献；名字不参与）。
 * @param {object} post 物化帖（可含 content.tags）
 * @param {string} authorEntityHash 作者
 * @param {import('./store.mjs').TasteStore} taste 观看者偏好
 * @returns {number} 匹配分 ≥ 0
 */
export function computeTasteMatch(post, authorEntityHash, taste) {
	const key = socialPostKey(authorEntityHash, post.id || post.postId)
	const inferred = taste.postTags[key]
	/** @type {string[]} */
	const tags = []
	if (inferred?.tags?.length)
		for (const t of inferred.tags) tags.push(t)
	const self = Array.isArray(post.content?.tags) ? post.content.tags : []
	const selfWeight = inferred?.selfWeight ?? 1
	for (const t of self) {
		const s = String(t).trim().toLowerCase()
		if (s && !tags.includes(s)) tags.push(s)
	}

	let match = 0
	for (const t of tags) {
		const canon = resolveTasteAlias(t, taste.aliases)
		const w = Number(taste.tags[canon]) || 0
		const isSelfOnly = self.map(x => String(x).toLowerCase()).includes(t) && !inferred?.tags?.includes(t)
		match += w * (isSelfOnly ? selfWeight : 1)
	}
	return Math.max(0, match)
}
