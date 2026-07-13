import { loadPersonalFilterSets, matchesPersonalListEntries } from 'npm:@steve02081504/fount-p2p/node/personal_block'
import { queryIndex } from '../../../../../../../scripts/search/invertedIndex.mjs'

import { groupSearchIndexPath } from '../lib/paths.mjs'
import { listUserGroups } from '../lib/userGroups.mjs'
import { getState } from '../dag/materialize.mjs'

import { ensureArchiveIndexed } from './index.mjs'

/**
 * @param {object} hit 索引命中
 * @returns {string} 跨群搜索游标
 */
export function globalSearchCursorKey(hit) {
	return `${Number(hit.ts || 0)}:${hit.groupId}:${hit.eventId}`
}

/**
 * @param {string} username replica
 * @param {object} [options] 搜索选项
 * @returns {Promise<{ query: string, items: object[], nextCursor: string | null }>}
 */
export async function searchAllGroups(username, options = {}) {
	const query = String(options.q || '').trim()
	const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100)
	if (query.length < 2) return { query, items: [], nextCursor: null }

	const personalFilter = options.viewerEntityHash
		? await loadPersonalFilterSets(options.viewerEntityHash)
		: null

	/** @type {object[]} */
	const merged = []
	for (const groupId of await listUserGroups(username)) {
		const indexDir = groupSearchIndexPath(username, groupId)
		const { state } = await getState(username, groupId)
		const channelIds = Object.keys(state.channels || {}).filter(id => state.channels[id]?.type === 'text')
		for (const channelId of channelIds)
			await ensureArchiveIndexed(username, groupId, channelId)

		const hits = await queryIndex({
			indexDir,
			shardKeys: channelIds,
			query,
			limit: limit * 2,
			verify: doc => {
				if (!String(doc.text || '').toLowerCase().includes(query.toLowerCase())) return false
				if (!personalFilter) return true
				const sender = String(doc.fields?.sender || '').trim().toLowerCase()
				return !matchesPersonalListEntries([
					...[...personalFilter.blockedSubjects].map(value => ({ scope: 'subject', value })),
					...[...personalFilter.hiddenSubjects].map(value => ({ scope: 'subject', value })),
					...[...personalFilter.blockedEntityHashes].map(value => ({ scope: 'entity', value })),
					...[...personalFilter.hiddenEntityHashes].map(value => ({ scope: 'entity', value })),
				], { pubKeyHash: sender })
			},
		})
		for (const hit of hits)
			merged.push({
				groupId,
				eventId: hit.fields?.eventId || hit.id,
				channelId: hit.fields?.channelId || hit.shardKey,
				text: hit.text,
				ts: hit.ts,
				sender: hit.fields?.sender || null,
				charId: hit.fields?.charId || null,
			})
	}

	merged.sort((left, right) => Number(right.ts) - Number(left.ts) || String(right.eventId).localeCompare(String(left.eventId)))

	let start = 0
	if (options.cursor) {
		const cursor = String(options.cursor)
		const index = merged.findIndex(row => globalSearchCursorKey(row) === cursor)
		start = index >= 0 ? index + 1 : 0
	}

	const page = merged.slice(start, start + limit + 1)
	const hasMore = page.length > limit
	const items = hasMore ? page.slice(0, limit) : page
	const nextCursor = hasMore && items.length
		? globalSearchCursorKey(items[items.length - 1])
		: null
	return { query, items, nextCursor }
}
