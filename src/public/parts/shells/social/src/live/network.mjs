/**
 * 联邦在播列表 part_query。
 */
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { getShellPartpath } from 'npm:@steve02081504/fount-p2p/registries/part_path'
import { queryNetwork, registerQueryInboundHandler } from 'npm:@steve02081504/fount-p2p/wire/part_query'

import { buildLiveFeed } from './feed.mjs'

/**
 *
 */
export const LIVE_FEED_KIND = 'live_feed'

/**
 * @param {{ replicaUsername?: string }} inboundContext 上下文
 * @param {unknown} query 查询
 * @returns {Promise<object[]>} rows
 */
export async function localLiveFeedHandler(inboundContext, query) {
	const username = String(inboundContext.replicaUsername || '').trim()
	if (!username) return []
	const limit = Math.min(Math.max(Number(
		query && typeof query === 'object' ? /** @type {{ limit?: unknown }} */query.limit : 20,
	) || 20, 1), 32)
	const { items } = await buildLiveFeed(username, { limit, scope: 'local' })
	const nodeHash = String(getNodeHash() || '').toLowerCase()
	return items
		.filter(row => row.visibility === 'public' || !row.visibility)
		.map(row => ({
			liveId: row.liveId,
			entityHash: row.entityHash,
			title: String(row.title || '').slice(0, 120),
			viewerCount: Number(row.viewerCount) || 0,
			likeCount: Number(row.likeCount) || 0,
			startedAt: Number(row.startedAt) || 0,
			avRoomId: row.avRoomId,
			bridgeOrigin: row.bridgeOrigin || null,
			watchSecret: row.publicWatchSecret || null,
			nodeHash,
		}))
}

/**
 * @returns {void}
 */
export function registerSocialLiveFeedQueryHandler() {
	registerQueryInboundHandler(getShellPartpath('social'), LIVE_FEED_KIND, localLiveFeedHandler)
}

/**
 * @returns {void}
 */
export function unregisterSocialLiveFeedQueryHandler() {
	registerQueryInboundHandler(getShellPartpath('social'), LIVE_FEED_KIND, () => [])
}

/**
 * @param {string} username replica
 * @param {{ limit?: number }} [options] 选项
 * @returns {Promise<{ items: object[], nextCursor: null, scope: 'nearby' }>} 附近在播
 */
export async function buildNearbyLiveFeed(username, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50)
	const rows = await queryNetwork(username, getShellPartpath('social'), LIVE_FEED_KIND, { limit }, {
		maxHits: 64,
		/**
		 * @param {object} row 网络行
		 * @returns {string} 去重键
		 */
		rowKey: row => {
			if (!row || typeof row !== 'object') return ''
			const entityHash = String(/** @type {{ entityHash?: unknown }} */row.entityHash || '').toLowerCase()
			const liveId = String(/** @type {{ liveId?: unknown }} */row.liveId || '').toLowerCase()
			return entityHash && liveId ? `${entityHash}:${liveId}` : ''
		},
	})
	const items = []
	for (const raw of rows) {
		if (!raw || typeof raw !== 'object') continue
		const entityHash = String(/** @type {{ entityHash?: unknown }} */raw.entityHash || '').trim().toLowerCase()
		const liveId = String(/** @type {{ liveId?: unknown }} */raw.liveId || '').trim().toLowerCase()
		if (!entityHash || !liveId) continue
		items.push({
			liveId,
			entityHash,
			title: String(/** @type {{ title?: unknown }} */raw.title || 'Live').slice(0, 120),
			viewerCount: Math.max(0, Number(/** @type {{ viewerCount?: unknown }} */raw.viewerCount) || 0),
			likeCount: Math.max(0, Number(/** @type {{ likeCount?: unknown }} */raw.likeCount) || 0),
			startedAt: Number(/** @type {{ startedAt?: unknown }} */raw.startedAt) || 0,
			avRoomId: String(/** @type {{ avRoomId?: unknown }} */raw.avRoomId || `social:${entityHash}:${liveId}`),
			bridgeOrigin: String(/** @type {{ bridgeOrigin?: unknown }} */raw.bridgeOrigin || '') || null,
			watchSecret: String(/** @type {{ watchSecret?: unknown }} */raw.watchSecret || '') || null,
			visibility: 'public',
			status: 'live',
			federated: true,
			nodeHash: String(/** @type {{ nodeHash?: unknown }} */raw.nodeHash || '').toLowerCase(),
		})
		if (items.length >= limit) break
	}
	items.sort((a, b) => (b.viewerCount || 0) - (a.viewerCount || 0) || (b.startedAt || 0) - (a.startedAt || 0))
	return { items, nextCursor: null, scope: 'nearby' }
}
