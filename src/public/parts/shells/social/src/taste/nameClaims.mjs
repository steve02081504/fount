/**
 * Tag 命名：签名时间线事件 tag_name（locale 区分）。名字永不进入聚类/打分。
 */
import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { pickNodeScore } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

import { loadFollowingForActor } from '../following.mjs'
import { commitTimelineEvent } from '../timeline/append.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'

import { collapseTasteWeights, loadTaste, resolveTasteAlias } from './store.mjs'

/**
 * 发布本地命名（tag_name 事件）；受 publishPreferences 控制是否 fanout。
 * @param {string} username replica
 * @param {string} entityHash 标注者
 * @param {{ tagHash: string, locale: string, label: string }} input 命名
 * @returns {Promise<object>} 签名事件
 */
export async function publishTagName(username, entityHash, input) {
	const tagHash = String(input.tagHash || '').trim().toLowerCase()
	const locale = String(input.locale || 'zh-CN').trim()
	const label = String(input.label || '').trim().slice(0, 64)
	const actor = String(entityHash).toLowerCase()
	if (!tagHash || !locale || !label || !parseEntityHash(actor))
		throw new Error('invalid tag name claim')
	const taste = await loadTaste(username, actor)
	const fanout = taste.privacy.publishPreferences !== false
	return commitTimelineEvent(username, actor, {
		type: 'tag_name',
		content: { tagHash, locale, label },
	}, { fanout })
}

/**
 * 信任加权解析显示名（自己 → 好友标注优先）。
 * @param {string} username replica
 * @param {string} viewerEntityHash 观看者
 * @param {string} tagHash tag
 * @param {string} [locale='zh-CN'] locale
 * @returns {Promise<string | null>} 显示名
 */
export async function resolveTagDisplayName(username, viewerEntityHash, tagHash, locale = 'zh-CN') {
	const viewer = String(viewerEntityHash).toLowerCase()
	const taste = await loadTaste(username, viewer)
	const canon = resolveTasteAlias(tagHash, taste.aliases)
	const ownView = await getTimelineMaterialized(username, viewer)
	const ownNames = ownView.tagNames || {}
	if (ownNames[canon]?.[locale]) return ownNames[canon][locale]
	if (ownNames[String(tagHash).toLowerCase()]?.[locale])
		return ownNames[String(tagHash).toLowerCase()][locale]

	const { following } = await loadFollowingForActor(username, viewer)
	/** @type {{ label: string, weight: number }[]} */
	const candidates = []
	for (const friend of following) {
		const view = await getTimelineMaterialized(username, friend)
		const names = view.tagNames || {}
		const friendTaste = await loadTaste(username, friend)
		const friendCanon = resolveTasteAlias(canon, friendTaste.aliases)
		const label = names[friendCanon]?.[locale] || names[canon]?.[locale]
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
 * @returns {Promise<{ tagHash: string, weight: number, label: string | null }[]>} 标签列表
 */
export async function listTasteTags(username, entityHash, locale = 'zh-CN') {
	const taste = await loadTaste(username, entityHash)
	const collapsed = collapseTasteWeights(taste)
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
