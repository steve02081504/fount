/**
 * Tag 命名标注 gossip（locale 区分）。名字永不进入聚类/打分。
 */
import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { pickNodeScore } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

import { collectSocialRpcMerged } from '../federation/part_wire_rpc.mjs'
import { loadFollowingForActor } from '../following.mjs'

import { mutateTaste, resolveTasteAlias } from './store.mjs'

/**
 * @param {object} claim 命名声明
 * @returns {boolean} 是否可用
 */
function isWellFormedNameClaim(claim) {
	const tagHash = String(claim?.tagHash || '').trim().toLowerCase()
	const locale = String(claim?.locale || '').trim()
	const label = String(claim?.label || '').trim()
	const annotator = String(claim?.annotator || '').trim().toLowerCase()
	return Boolean(
		tagHash && locale && label && label.length <= 64
		&& parseEntityHash(annotator),
	)
}

/**
 * 入站命名声明：仅当标注者在关注圈时写入本地 names（显示用）。
 * @param {string} username replica
 * @param {object} claim 声明
 * @param {{ requesterNodeHash?: string | null }} [_ingress] 入站
 * @returns {Promise<{ ok: boolean }>}
 */
export async function ingestTagNameClaim(username, claim, _ingress = {}) {
	if (!isWellFormedNameClaim(claim)) return { ok: false }
	const annotator = String(claim.annotator).toLowerCase()
	const tagHash = String(claim.tagHash).toLowerCase()
	const locale = String(claim.locale).trim()
	const label = String(claim.label).trim().slice(0, 64)

	// 写入所有本机有偏好表且关注标注者（或自己）的实体会过重；这里写到 annotator 自己的 taste，
	// 显示解析时再按好友加权取。对观看者主动拉取时另存观测。
	await mutateTaste(username, annotator, store => {
		const canon = resolveTasteAlias(tagHash, store.aliases)
		store.names[canon] ??= {}
		store.names[canon][locale] = label
		return store
	}).catch(() => null)

	return { ok: true }
}

/**
 * 发布本地命名并 gossip。
 * @param {string} username replica
 * @param {string} entityHash 标注者
 * @param {{ tagHash: string, locale: string, label: string }} input 命名
 * @returns {Promise<import('./store.mjs').TasteStore>}
 */
export async function publishTagName(username, entityHash, input) {
	const claim = {
		tagHash: String(input.tagHash).trim().toLowerCase(),
		locale: String(input.locale || 'zh-CN').trim(),
		label: String(input.label || '').trim().slice(0, 64),
		annotator: String(entityHash).toLowerCase(),
	}
	if (!isWellFormedNameClaim(claim)) throw new Error('invalid tag name claim')
	const store = await mutateTaste(username, claim.annotator, draft => {
		const canon = resolveTasteAlias(claim.tagHash, draft.aliases)
		draft.names[canon] ??= {}
		draft.names[canon][claim.locale] = claim.label
		return draft
	})
	if (store.privacy.publishPreferences !== false)
		await collectSocialRpcMerged(username, { type: 'social_tag_name_claim', claim }, 2000, 6)
	return store
}

/**
 * 信任加权解析显示名（好友标注优先）。
 * @param {string} username replica
 * @param {string} viewerEntityHash 观看者
 * @param {string} tagHash tag
 * @param {string} [locale='zh-CN'] locale
 * @returns {Promise<string | null>} 显示名
 */
export async function resolveTagDisplayName(username, viewerEntityHash, tagHash, locale = 'zh-CN') {
	const viewer = String(viewerEntityHash).toLowerCase()
	const { loadTaste } = await import('./store.mjs')
	const own = await loadTaste(username, viewer)
	const canon = resolveTasteAlias(tagHash, own.aliases)
	if (own.names[canon]?.[locale]) return own.names[canon][locale]

	const { following } = await loadFollowingForActor(username, viewer)
	/** @type {{ label: string, weight: number }[]} */
	const candidates = []
	for (const friend of following) {
		const taste = await loadTaste(username, friend)
		const label = taste.names[resolveTasteAlias(canon, taste.aliases)]?.[locale]
			|| taste.names[canon]?.[locale]
		if (!label) continue
		const parsed = parseEntityHash(friend)
		const score = parsed ? pickNodeScore(parsed.nodeHash) : 0
		candidates.push({ label, weight: Math.max(0.05, 0.5 + score / 2) })
	}
	if (!candidates.length) return null
	candidates.sort((a, b) => b.weight - a.weight)
	return candidates[0].label
}

/**
 * 列出观看者偏好 tags（含解析名）。
 * @param {string} username replica
 * @param {string} entityHash acting
 * @param {string} [locale='zh-CN'] locale
 * @returns {Promise<{ tagHash: string, weight: number, label: string | null }[]>}
 */
export async function listTasteTags(username, entityHash, locale = 'zh-CN') {
	const { loadTaste } = await import('./store.mjs')
	const taste = await loadTaste(username, entityHash)
	/** @type {Map<string, number>} */
	const collapsed = new Map()
	for (const [raw, weight] of Object.entries(taste.tags)) {
		const canon = resolveTasteAlias(raw, taste.aliases)
		collapsed.set(canon, (collapsed.get(canon) || 0) + Number(weight) || 0)
	}
	const rows = []
	for (const [tagHash, weight] of collapsed) {
		if (!weight) continue
		rows.push({
			tagHash,
			weight,
			label: await resolveTagDisplayName(username, entityHash, tagHash, locale),
		})
	}
	rows.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
	return rows
}
