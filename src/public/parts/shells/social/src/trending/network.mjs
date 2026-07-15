import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { getShellPartpath } from 'npm:@steve02081504/fount-p2p/registries/part_path'
import { queryNetwork, registerQueryInboundHandler } from 'npm:@steve02081504/fount-p2p/wire/part_query'

import { buildTrendingHashtags } from './hashtags.mjs'

/**
 *
 */
export const TRENDING_HASHTAGS_KIND = 'trending_hashtags'

const TAG_MAX_LEN = 32
const TAG_RE = /^[\p{L}\p{N}_-]{2,32}$/u

/**
 * @param {unknown} raw 原始行
 * @returns {{ tag: string, count: number, nodeHash: string } | null} 清洗后行
 */
function sanitizeTrendingRow(raw) {
	if (!raw || typeof raw !== 'object') return null
	const tag = String(/** @type {{ tag?: unknown }} */raw.tag || '').trim().toLowerCase().slice(0, TAG_MAX_LEN)
	if (!TAG_RE.test(tag)) return null
	const count = Math.min(Math.max(Number(/** @type {{ count?: unknown }} */raw.count) || 0, 0), 1_000_000)
	if (!count) return null
	const nodeHash = String(/** @type {{ nodeHash?: unknown }} */raw.nodeHash || '').trim().toLowerCase().slice(0, 128)
	return { tag, count, nodeHash }
}

/**
 * 本机应答：公开可见话题计数（带本节点 hash 以免聚合时被去重吞并）。
 * @param {{ replicaUsername?: string }} ctx 入站上下文
 * @param {unknown} query 查询
 * @returns {Promise<object[]>} rows
 */
export async function localTrendingHashtagsHandler(ctx, query) {
	const username = String(ctx.replicaUsername || '').trim()
	if (!username) return []
	const limit = Math.min(Math.max(Number(
		query && typeof query === 'object' ? /** @type {{ limit?: unknown }} */query.limit : 12,
	) || 12, 1), 32)
	const { tags } = await buildTrendingHashtags(username, { limit })
	const nodeHash = String(getNodeHash() || '').toLowerCase()
	return tags.map(row => ({
		tag: row.tag,
		count: row.count,
		nodeHash,
	}))
}

/**
 * Social Load：注册 trending_hashtags part_query handler。
 * @returns {void}
 */
export function registerSocialTrendingQueryHandler() {
	registerQueryInboundHandler(getShellPartpath('social'), TRENDING_HASHTAGS_KIND, localTrendingHashtagsHandler)
}

/**
 * Social Unload：清空 handler。
 * @returns {void}
 */
export function unregisterSocialTrendingQueryHandler() {
	registerQueryInboundHandler(getShellPartpath('social'), TRENDING_HASHTAGS_KIND, () => [])
}

/**
 * 聚合本机与邻居话题热度。
 * @param {string} username 用户
 * @param {{ limit?: number, viewerEntityHash?: string }} [options] 选项
 * @returns {Promise<{ tags: { tag: string, count: number }[], scope: 'nearby' }>} 附近热搜
 */
export async function buildNearbyTrendingHashtags(username, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 12, 1), 32)
	const partpath = getShellPartpath('social')
	const rows = await queryNetwork(username, partpath, TRENDING_HASHTAGS_KIND, { limit }, {
		maxHits: 128,
		/**
		 * @param {unknown} row 行
		 * @returns {string} 去重键（同 tag 不同节点保留）
		 */
		rowKey: row => {
			const cleaned = sanitizeTrendingRow(row)
			if (!cleaned) return ''
			return `${cleaned.nodeHash || 'anon'}:${cleaned.tag}`
		},
	})

	/** @type {Map<string, number>} */
	const counts = new Map()
	for (const raw of rows) {
		const row = sanitizeTrendingRow(raw)
		if (!row) continue
		counts.set(row.tag, (counts.get(row.tag) || 0) + row.count)
	}

	const tags = [...counts.entries()]
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
		.slice(0, limit)
		.map(([tag, count]) => ({ tag, count }))

	return { tags, scope: 'nearby' }
}
