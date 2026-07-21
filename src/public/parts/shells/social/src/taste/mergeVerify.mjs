/**
 * Tag 合并懒验证：用量 / 互斥 / 拟合，一律信任加权本地数据。
 */
import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { pickNodeScore } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

import { socialPostKey } from '../federation/post_key.mjs'
import { loadFollowingForActor } from '../following.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'

import { weightedJaccard } from './jaccard.mjs'
import { loadTaste, resolveTasteAlias } from './store.mjs'

/**
 *
 */
export const MIN_USAGE = 2
/**
 *
 */
export const MIN_FIT = 0.35
/**
 *
 */
export const MAX_EXCLUSIVE_OVERLAP = 0.15

/**
 * @param {string} entityHash 实体
 * @returns {number} 信任权重
 */
function trustWeight(entityHash) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return 0
	const score = pickNodeScore(parsed.nodeHash)
	return Math.max(0.05, Math.min(1, 0.5 + score / 2))
}

/**
 * 从本地关注圈积累 tag → 受众向量 / 用量。
 * @param {string} username replica
 * @param {string} entityHash acting
 * @param {import('./store.mjs').TasteStore} [tasteHint] 可选预载偏好
 * @returns {Promise<{ usage: Map<string, number>, audiences: Map<string, Map<string, number>> }>} 用量与受众
 */
export async function localTagStats(username, entityHash, tasteHint = null) {
	const taste = tasteHint || await loadTaste(username, entityHash)
	const { following } = await loadFollowingForActor(username, entityHash)
	/** @type {Map<string, number>} */
	const usage = new Map()
	/** @type {Map<string, Map<string, number>>} */
	const audiences = new Map()

	/**
	 * @param {string} tag 标签
	 * @param {string} reactor 反应者
	 * @param {number} w 权重
	 * @returns {void}
	 */
	function bump(tag, reactor, w) {
		const canon = resolveTasteAlias(tag, taste.aliases)
		usage.set(canon, (usage.get(canon) || 0) + w)
		if (!audiences.has(canon)) audiences.set(canon, new Map())
		const aud = audiences.get(canon)
		aud.set(reactor, (aud.get(reactor) || 0) + w)
	}

	const actors = [entityHash, ...following]
	for (const actor of actors) {
		if (!parseEntityHash(actor)) continue
		const view = await getTimelineMaterialized(username, actor)
		const w = trustWeight(actor)
		for (const like of view.likes || []) {
			const key = socialPostKey(like.content?.targetEntityHash, like.content?.targetPostId)
			const tags = taste.postTags[key]?.tags || []
			for (const tag of tags) bump(tag, actor, w)
		}
		for (const post of view.posts || []) {
			const tags = Array.isArray(post.content?.tags) ? post.content.tags : []
			for (const tag of tags) bump(String(tag).toLowerCase(), actor, w * 0.5)
		}
	}
	return { usage, audiences }
}

/**
 * @param {{ usage: Map<string, number>, audiences: Map<string, Map<string, number>> }} stats 预计算统计
 * @param {{ from: string, to: string, evidence?: object }} claim 声明
 * @returns {{ ok: boolean, confidence: number, reason?: string }} 验证结果
 */
export function verifyTagMergeClaimWithStats(stats, claim) {
	const from = String(claim.from || '').trim().toLowerCase()
	const to = String(claim.to || '').trim().toLowerCase()
	if (!from || !to || from === to) return { ok: false, confidence: 0, reason: 'malformed' }

	const { usage, audiences } = stats
	const usageFrom = usage.get(from) || 0
	const usageTo = usage.get(to) || 0
	if (usageFrom < MIN_USAGE || usageTo < MIN_USAGE)
		return { ok: false, confidence: 0, reason: 'usage' }

	const audFrom = audiences.get(from) || new Map()
	const audTo = audiences.get(to) || new Map()
	const fit = weightedJaccard(audFrom, audTo)
	if (fit < MIN_FIT) return { ok: false, confidence: 0, reason: 'fit' }

	let worstExclusive = 0
	for (const [other, aud] of audiences) {
		if (other === from || other === to) continue
		if ((usage.get(other) || 0) < MIN_USAGE) continue
		const overlapFrom = weightedJaccard(audFrom, aud)
		const overlapTo = weightedJaccard(audTo, aud)
		if (overlapFrom > 0.5 && overlapTo < MAX_EXCLUSIVE_OVERLAP)
			worstExclusive = Math.max(worstExclusive, overlapFrom - overlapTo)
	}
	if (worstExclusive > 0.4) return { ok: false, confidence: 0, reason: 'exclusive' }

	const confidence = Math.min(1, fit * Math.log1p(Math.min(usageFrom, usageTo)) / 3)
	return { ok: true, confidence }
}

/**
 * @param {string} username replica
 * @param {string} entityHash acting
 * @param {{ from: string, to: string, evidence?: object }} claim 声明
 * @returns {Promise<{ ok: boolean, confidence: number, reason?: string }>} 验证结果
 */
export async function verifyTagMergeClaim(username, entityHash, claim) {
	const stats = await localTagStats(username, entityHash)
	return verifyTagMergeClaimWithStats(stats, claim)
}
