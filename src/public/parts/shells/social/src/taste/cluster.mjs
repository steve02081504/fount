/**
 * 反应图信任加权 Jaccard 聚类 → 本地口味 tag。
 * 点踩为负向证据；所有计数信任加权；禁止裸全局计数。
 */
import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { pickNodeScore } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

import { loadDwellTagBoosts } from '../engagement/dwell.mjs'
import { socialPostKey } from '../federation/post_key.mjs'
import { summarizeReactions } from '../federation/reaction_index.mjs'
import { pullPostReactions } from '../federation/reaction_pull.mjs'
import { loadFollowingForActor } from '../following.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'

import { weightedJaccard } from './jaccard.mjs'
import { gossipTagMergeClaim, lazyVerifyPendingMergeClaims } from './mergeClaims.mjs'
import { localTagStats, verifyTagMergeClaimWithStats } from './mergeVerify.mjs'
import { loadTaste, mutateTaste, resolveTasteAlias, tasteWeightOf } from './store.mjs'

/**
 *
 */
export { weightedJaccard } from './jaccard.mjs'

const JACCARD_MERGE = 0.45
const SENIORITY_MIN_POSTS = 2
const CLUSTER_STALE_MS = 6 * 60 * 60 * 1000
const MAX_POSTS_SCAN = 400
const REACTION_PULL_ON_REBUILD = 30
const LOCAL_MERGE_MIN_FIT = 0.55

/**
 * @param {string} entityHash 实体
 * @returns {number} 信任权重 ∈ (0, 1]
 */
function trustWeightOfEntity(entityHash) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return 0
	const score = pickNodeScore(parsed.nodeHash)
	return Math.max(0.05, Math.min(1, 0.5 + score / 2))
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
 * @returns {Promise<Map<string, { likes: Map<string, number>, dislikes: Map<string, number>, selfTags: string[] }>>} 帖 → 受众
 */
async function collectPostAudiences(username, entityHash, following) {
	/** @type {Map<string, { likes: Map<string, number>, dislikes: Map<string, number>, selfTags: string[] }>} */
	const posts = new Map()

	/**
	 * @param {string} author 作者
	 * @param {string} postId 帖 id
	 * @returns {{ likes: Map<string, number>, dislikes: Map<string, number>, selfTags: string[] }} 受众行
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

	const scanKeys = [...posts.keys()].slice(0, MAX_POSTS_SCAN)
	for (const key of scanKeys) {
		const [author, postId] = key.split(':')
		if (!author || !postId) continue
		const row = posts.get(key)
		if (!row) continue
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
	const all = [...appear.keys()].sort()
	return all[0] || null
}

/**
 * @param {Map<string, Map<string, number>>} postAudiences postKey → audience
 * @returns {Map<string, string>} postKey → tagHash
 */
export function clusterPostsByAudience(postAudiences) {
	const keys = [...postAudiences.keys()].slice(0, MAX_POSTS_SCAN)
	/** @type {number[]} */
	const parent = keys.map((_, i) => i)
	/**
	 * @param {number} i 下标
	 * @returns {number} 根
	 */
	function find(i) {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]]
			i = parent[i]
		}
		return i
	}
	/**
	 * @param {number} a 下标 a
	 * @param {number} b 下标 b
	 * @returns {void}
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
 * @param {string} username replica
 * @param {string} actor acting
 * @returns {Promise<void>}
 */
async function pullRecentReactionPosts(username, actor) {
	const view = await getTimelineMaterialized(username, actor)
	/** @type {{ key: string, at: number, author: string, postId: string }[]} */
	const targets = []
	for (const like of view.likes || []) {
		const author = String(like.content?.targetEntityHash || '').toLowerCase()
		const postId = String(like.content?.targetPostId || '')
		if (!parseEntityHash(author) || !postId) continue
		targets.push({
			key: socialPostKey(author, postId),
			at: Number(like.hlc?.wall || like.timestamp) || 0,
			author,
			postId,
		})
	}
	for (const dislike of view.dislikes || []) {
		const author = String(dislike.content?.targetEntityHash || '').toLowerCase()
		const postId = String(dislike.content?.targetPostId || '')
		if (!parseEntityHash(author) || !postId) continue
		targets.push({
			key: socialPostKey(author, postId),
			at: Number(dislike.hlc?.wall || dislike.timestamp) || 0,
			author,
			postId,
		})
	}
	targets.sort((a, b) => b.at - a.at)
	const seen = new Set()
	let pulled = 0
	for (const row of targets) {
		if (seen.has(row.key)) continue
		seen.add(row.key)
		await pullPostReactions(username, row.author, row.postId).catch(() => null)
		pulled++
		if (pulled >= REACTION_PULL_ON_REBUILD) break
	}
}

/**
 * @param {string} username replica
 * @param {string} actor acting
 * @param {import('./store.mjs').TasteStore} store 偏好
 * @param {{ usage: Map<string, number>, audiences: Map<string, Map<string, number>> }} stats 统计
 * @returns {Promise<void>}
 */
async function discoverAndGossipMerges(username, actor, store, stats) {
	const tags = [...stats.audiences.keys()].sort()
	for (let i = 0; i < tags.length; i++) 
		for (let j = i + 1; j < tags.length; j++) {
			const a = tags[i]
			const b = tags[j]
			const fit = weightedJaccard(stats.audiences.get(a), stats.audiences.get(b))
			if (fit < LOCAL_MERGE_MIN_FIT) continue
			const from = a < b ? a : b
			const to = a < b ? b : a
			const claim = { from, to, evidence: { fit, local: true } }
			const result = verifyTagMergeClaimWithStats(stats, claim)
			if (!result.ok) continue
			await mutateTaste(username, actor, draft => {
				draft.aliases[from] = {
					to,
					confidence: result.confidence,
					evidence: { fit, verifiedAt: Date.now() },
				}
				return draft
			})
			if (store.privacy.publishPreferences !== false)
				await gossipTagMergeClaim(username, claim).catch(() => null)
		}
	
}

/**
 * 重建实体口味表。
 * @param {string} username replica
 * @param {string} entityHash acting
 * @returns {Promise<import('./store.mjs').TasteStore>} 更新后偏好
 */
export async function rebuildTaste(username, entityHash) {
	const actor = String(entityHash).toLowerCase()
	await pullRecentReactionPosts(username, actor)

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

	const dwellTags = await loadDwellTagBoosts(username, actor)
	const store = await mutateTaste(username, actor, draft => {
		/** @type {Record<string, number>} */
		const computed = {}
		/** @type {Record<string, { tags: string[], selfWeight: number }>} */
		const postTags = {}

		for (const [key, signal] of ownSignal) {
			const clusterTag = assignment.get(key)
			const declared = selfTags.get(key) || []
			const reactionCount = Math.abs(signal)
			const selfWeight = 1 / (1 + reactionCount)
			/** @type {string[]} */
			const tagList = []
			if (clusterTag) tagList.push(clusterTag)
			for (const t of declared)
				if (!tagList.includes(t)) tagList.push(t)

			postTags[key] = { tags: tagList, selfWeight }

			for (const rawTag of tagList) {
				const canon = resolveTasteAlias(rawTag, draft.aliases)
				const isSelf = declared.includes(rawTag) && rawTag !== clusterTag
				const delta = signal * (isSelf ? selfWeight : 1)
				computed[canon] = (computed[canon] || 0) + delta
			}
		}

		for (const [rawTag, weight] of dwellTags) {
			const canon = resolveTasteAlias(rawTag, draft.aliases)
			computed[canon] = (computed[canon] || 0) + weight
		}

		draft.computed = computed
		draft.postTags = postTags
		draft.clusteredAt = Date.now()
		return draft
	})

	const stats = await localTagStats(username, actor, store)
	await lazyVerifyPendingMergeClaims(username, actor, stats)
	await discoverAndGossipMerges(username, actor, store, stats)
	return loadTaste(username, actor)
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
 * 帖与观看者偏好的匹配分（可负；名字不参与）。
 * @param {object} post 物化帖（可含 content.tags）
 * @param {string} authorEntityHash 作者
 * @param {import('./store.mjs').TasteStore} taste 观看者偏好
 * @returns {number} 匹配分（可负）
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
		const w = tasteWeightOf(taste, t)
		const isSelfOnly = self.map(x => String(x).toLowerCase()).includes(t) && !inferred?.tags?.includes(t)
		match += w * (isSelfOnly ? selfWeight : 1)
	}
	return match
}
