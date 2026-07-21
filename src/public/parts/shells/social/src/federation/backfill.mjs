/**
 * Feed 空/不足时的联邦补给：一跳关注 sync → 一跳 discover+sync → 多跳 post_discover ingest。
 */
import { discoverWithNetwork } from '../discover/network.mjs'
import { collectNearbyPostDiscover } from '../discover/postDiscover.mjs'
import { ingestRemoteTimelineEvent, syncFollowingTimelines, syncTimelineForEntity } from '../timeline/sync.mjs'

/** @type {Map<string, Promise<object>>} */
const inFlight = new Map()

/**
 * @param {string} username replica
 * @param {object} [options] 选项
 * @param {string} [options.viewerEntityHash] 观看者
 * @param {boolean} [options.mediaOnly] 仅媒体帖
 * @param {() => Promise<boolean> | boolean} [options.enough] 本地是否已足够（每步后检查）
 * @returns {Promise<{ phase: string, imported: number }>} 补给结果
 */
export async function backfillPosts(username, options = {}) {
	const mediaOnly = options.mediaOnly === true
	const key = `${username}:${mediaOnly ? 'media' : 'all'}`
	const existing = inFlight.get(key)
	if (existing) return existing

	const promise = runBackfill(username, options).finally(() => {
		if (inFlight.get(key) === promise) inFlight.delete(key)
	})
	inFlight.set(key, promise)
	return promise
}

/**
 * @param {string} username replica
 * @param {object} options 选项
 * @returns {Promise<{ phase: string, imported: number }>} 结果
 */
async function runBackfill(username, options) {
	const enough = typeof options.enough === 'function'
		? options.enough
		: async () => false
	let imported = 0

	if (await enough()) return { phase: 'skip', imported: 0 }

	const syncStats = await syncFollowingTimelines(username)
	imported += Number(syncStats.imported) || 0
	if (await enough()) return { phase: 'following', imported }

	const discovered = await discoverWithNetwork(username, {
		type: 'social_post_discover_request',
		n: 20,
		mediaOnly: options.mediaOnly === true,
	}, { viewerEntityHash: options.viewerEntityHash || null })

	const entityHashes = [...new Set(
		(discovered.posts || [])
			.map(row => String(row.entityHash || '').toLowerCase())
			.filter(Boolean),
	)].slice(0, 16)

	const discoverResults = await Promise.allSettled(
		entityHashes.map(entityHash => syncTimelineForEntity(username, entityHash)),
	)
	for (const result of discoverResults)
		if (result.status === 'fulfilled') imported += result.value
	if (await enough()) return { phase: 'discover', imported }

	const { items } = await collectNearbyPostDiscover(username, {
		limit: 24,
		mediaOnly: options.mediaOnly === true,
		ttl: 3,
	})
	for (const item of items)
		if (await ingestRemoteTimelineEvent(username, item.entityHash, item.event))
			imported++
	return { phase: 'multihop', imported }
}
