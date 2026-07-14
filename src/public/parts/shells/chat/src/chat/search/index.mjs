import { loadPersonalFilterSets, matchesPersonalListEntries } from 'npm:@steve02081504/fount-p2p/node/personal_block'

import { indexDocument, patchShardMeta, queryIndex, removeDocument } from '../../../../../../../scripts/search/invertedIndex.mjs'
import { channelMessageShowText } from '../../../public/shared/channelContent.mjs'
import { loadArchiveManifest } from '../archive/index.mjs'
import { readArchiveAsMessageLines } from '../archive/reader.mjs'
import { groupSearchIndexPath } from '../lib/paths.mjs'

/**
 * @param {object} messageLine 频道消息行
 * @returns {string} 可索引正文
 */
export function searchTextFromMessageLine(messageLine) {
	if (messageLine?.decryptView?.failed) return ''
	const content = messageLine?.content
	if (messageLine?.type === 'message_edit')
		return channelMessageShowText(content?.newContent ?? content)
	if (messageLine?.type === 'message_delete') return ''
	return channelMessageShowText(content)
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} messageLine 消息行
 * @returns {Promise<void>}
 */
export async function indexChannelMessageLine(username, groupId, channelId, messageLine) {
	const indexDir = groupSearchIndexPath(username, groupId)
	const type = messageLine?.type

	if (type === 'message_delete') {
		const targetId = String(messageLine.content?.targetId || '').trim().toLowerCase()
		if (targetId) await removeDocument(indexDir, channelId, targetId)
		return
	}

	if (type === 'message_edit') {
		const targetId = String(messageLine.content?.targetId || '').trim().toLowerCase()
		const newContent = messageLine.content?.newContent
		if (!targetId || newContent?.is_generating) return
		const text = channelMessageShowText(newContent)
		if (!text) return
		await indexDocument(indexDir, channelId, {
			id: targetId,
			text,
			ts: Number(messageLine.hlc?.wall || messageLine.timestamp || Date.now()),
			fields: { channelId, eventId: targetId, sender: messageLine.sender || '' },
		})
		return
	}

	if (type !== 'message') return
	const eventId = String(messageLine.eventId || '').trim().toLowerCase()
	if (!eventId) return
	const text = searchTextFromMessageLine(messageLine)
	if (!text) return
	await indexDocument(indexDir, channelId, {
		id: eventId,
		text,
		ts: Number(messageLine.hlc?.wall || messageLine.timestamp || Date.now()),
		fields: {
			channelId,
			eventId,
			sender: messageLine.sender || '',
			charId: messageLine.charId || null,
		},
	})
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<void>}
 */
export async function ensureArchiveIndexed(username, groupId, channelId) {
	const manifest = await loadArchiveManifest(username, groupId)
	const months = manifest?.channels?.[channelId]?.months || []
	if (!months.length) return

	const indexDir = groupSearchIndexPath(username, groupId)
	const meta = await patchShardMeta(indexDir, channelId, {})
	const coverage = meta.coverage || {}
	const pending = months.filter(month => !coverage[month])
	if (!pending.length) return

	const lines = await readArchiveAsMessageLines(username, groupId, channelId, pending)
	for (const line of lines) {
		if (line.type !== 'message') continue
		await indexChannelMessageLine(username, groupId, channelId, line)
	}

	await patchShardMeta(indexDir, channelId, {
		coverage: Object.fromEntries(months.map(month => [month, true])),
	})
}

/**
 * @param {string} query 查询
 * @param {string} text 正文
 * @returns {boolean} 是否匹配
 */
function messageMatchesQuery(query, text) {
	const q = String(query || '').trim().toLowerCase()
	if (q.length < 2) return false
	return String(text || '').toLowerCase().includes(q)
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} options 选项
 * @param {string} options.q 查询
 * @param {string} [options.channelId] 限定频道
 * @param {number} [options.limit=30] 上限
 * @param {string} [options.viewerEntityHash] 观看者实体（personal filter）
 * @returns {Promise<{ query: string, items: object[] }>} 规范化查询串与命中消息列表
 */
export async function searchGroupMessages(username, groupId, options = {}) {
	const query = String(options.q || '').trim()
	const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100)
	if (query.length < 2) return { query, items: [] }

	const indexDir = groupSearchIndexPath(username, groupId)
	const { getState } = await import('../dag/materialize.mjs')
	const { state } = await getState(username, groupId)
	const channelIds = options.channelId
		? [String(options.channelId)]
		: Object.keys(state.channels || {}).filter(id => state.channels[id]?.type === 'text')

	for (const channelId of channelIds)
		await ensureArchiveIndexed(username, groupId, channelId)

	const personalFilter = options.viewerEntityHash
		? await loadPersonalFilterSets(options.viewerEntityHash)
		: null

	const hits = await queryIndex({
		indexDir,
		shardKeys: channelIds,
		query,
		limit: limit * 3,
		/**
		 * 倒排索引候选二次校验（子串 + 个人过滤）。
		 * @param {object} doc 索引文档行
		 * @returns {boolean} 是否保留该命中
		 */
		verify: doc => {
			if (!messageMatchesQuery(query, doc.text)) return false
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

	const items = hits.slice(0, limit).map(hit => ({
		eventId: hit.fields?.eventId || hit.id,
		channelId: hit.fields?.channelId || hit.shardKey,
		text: hit.text,
		ts: hit.ts,
		sender: hit.fields?.sender || null,
		charId: hit.fields?.charId || null,
	}))

	return { query, items }
}
