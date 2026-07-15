/**
 * 在播列表：关注优先 + 观众数排序；可选联邦 nearby。
 */
import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { loadFollowingForActor } from '../following.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'
import { getTimelineOwnerIndex } from '../timeline/ownerIndex.mjs'

import { listActiveLiveSessions, loadLiveSession } from './session.mjs'

/**
 * @param {string} username replica
 * @param {{ limit?: number, cursor?: string, viewerEntityHash?: string, scope?: string }} [options] 选项
 * @returns {Promise<{ items: object[], nextCursor: string | null, scope: string }>} 在播列表
 */
export async function buildLiveFeed(username, options = {}) {
	if (String(options.scope || '') === 'nearby') {
		const { buildNearbyLiveFeed } = await import('./network.mjs')
		return buildNearbyLiveFeed(username, options)
	}
	const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50)
	const viewer = options.viewerEntityHash || null
	const { following } = viewer
		? await loadFollowingForActor(username, viewer)
		: { following: [] }
	const followingSet = new Set(following.map(id => id.toLowerCase()))
	const owners = (await getTimelineOwnerIndex(username)).all

	/** @type {object[]} */
	const items = []
	const seen = new Set()
	for (const entityHash of owners) {
		if (!isEntityHash128(entityHash)) continue
		for (const session of listActiveLiveSessions(username, entityHash)) {
			const key = `${session.entityHash}:${session.liveId}`
			if (seen.has(key)) continue
			seen.add(key)
			items.push({
				...session,
				following: followingSet.has(session.entityHash),
			})
		}
		const view = await getTimelineMaterialized(username, entityHash)
		for (const [liveId, event] of Object.entries(view.activeLives || {})) {
			const key = `${entityHash}:${liveId}`
			if (seen.has(key)) continue
			const session = loadLiveSession(username, entityHash, liveId)
			if (session?.status === 'live') {
				seen.add(key)
				items.push({ ...session, following: followingSet.has(entityHash) })
				continue
			}
			seen.add(key)
			items.push({
				liveId,
				entityHash,
				title: event.content?.title || 'Live',
				visibility: event.content?.visibility || 'public',
				status: 'live',
				startedAt: Number(event.hlc?.wall) || Date.now(),
				viewerCount: 0,
				avRoomId: event.content?.avRoomId || `social:${entityHash}:${liveId}`,
				chatMount: event.content?.chatMount || null,
				following: followingSet.has(entityHash),
			})
		}
	}

	items.sort((a, b) => {
		if (a.following !== b.following) return a.following ? -1 : 1
		const vc = (b.viewerCount || 0) - (a.viewerCount || 0)
		if (vc) return vc
		return (b.startedAt || 0) - (a.startedAt || 0)
	})

	let start = 0
	if (options.cursor) {
		const idx = items.findIndex(row => `${row.entityHash}:${row.liveId}` === options.cursor)
		start = idx >= 0 ? idx + 1 : 0
	}
	const page = items.slice(start, start + limit)
	const nextCursor = page.length === limit && start + limit < items.length
		? `${page[page.length - 1].entityHash}:${page[page.length - 1].liveId}`
		: null
	return { items: page, nextCursor, scope: 'local' }
}
