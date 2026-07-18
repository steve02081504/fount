/**
 * Hub 频道消息 Store：source 合并、展示链折叠、导航补拉（无 DOM）。
 */
import { compareHex64Asc } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'

import { mergeChannelMessagesForDisplay } from '../../shared/messageMerge.mjs'
import { getChannelViewLogByEventIds } from '../../src/api/groupChannel.mjs'
import { normalizeEventId } from '../../src/lib/eventId.mjs'
import { applyChannelDisplayChain } from '../../src/ui/channelDisplay.mjs'
import { hubStore } from '../core/state.mjs'
import { isHubMemberPersonallyFiltered } from '../personalFilter.mjs'

/**
 * @param {string | null} eventId 目标 eventId；null 清除
 * @param {string | null} [groupId] 群 ID（默认当前群）
 * @param {string | null} [channelId] 频道 ID（默认当前频道）
 * @returns {void}
 */
export function setPendingScrollTarget(eventId, groupId = hubStore.context.currentGroupId, channelId = hubStore.context.currentChannelId) {
	if (!eventId) {
		hubStore.messages.pendingScrollTarget = null
		return
	}
	hubStore.messages.pendingScrollTarget = {
		groupId,
		channelId,
		eventId: String(eventId).trim(),
	}
}

/**
 * @returns {string | null} 消费并清除待滚动锚点（群/频道不匹配则丢弃）
 */
export function consumePendingScrollTarget() {
	const target = hubStore.messages.pendingScrollTarget
	hubStore.messages.pendingScrollTarget = null
	if (!target?.eventId) return null
	if (target.groupId !== hubStore.context.currentGroupId) return null
	if (target.channelId !== hubStore.context.currentChannelId) return null
	return target.eventId
}

/**
 * @param {object[]} rows 消息行
 * @returns {object[]} 按时间排序
 */
export function sortChannelRows(rows) {
	return [...rows].sort((a, b) => {
		const ta = Number(a.timestamp) || 0
		const tb = Number(b.timestamp) || 0
		if (ta !== tb) return ta - tb
		return compareHex64Asc(a.eventId, b.eventId)
	})
}

/**
 * 由 source 重建 channelMessages（分叉链 + 可选搜索）。
 * @param {(message: object) => string} [messageTextFn] 取展示文本，用于搜索过滤
 * @returns {void}
 */
export function refreshChannelMessagesView(messageTextFn = null) {
	let work = applyChannelDisplayChain(hubStore.messages.channelMessagesSource)
	work = work.filter(row => !isHubMemberPersonallyFiltered('', row.authorPubKeyHash || row.sender))
	const q = hubStore.messages.channelSearchQuery
	if (q && messageTextFn)
		work = work.filter(row => messageTextFn(row).toLowerCase().includes(q))
	hubStore.messages.channelMessages = mergeChannelMessagesForDisplay(work)
}

/**
 * @param {string} eventId 消息 event id
 * @returns {number} `channelMessages` 中的索引，未找到为 -1
 */
export function findMessageViewIndex(eventId) {
	const norm = normalizeEventId(eventId)
	if (!norm) return -1
	return hubStore.messages.channelMessages.findIndex(
		row => normalizeEventId(row.eventId) === norm,
	)
}

/**
 * 将远端行合并进 `channelMessagesSource`（按 eventId 去重）。
 * @param {object[]} fetched 拉取到的行
 * @returns {{ added: number }} 新写入条数
 */
export function mergeRowsIntoSource(fetched) {
	if (!Array.isArray(fetched) || !fetched.length) return { added: 0 }
	const known = new Set(
		hubStore.messages.channelMessagesSource.map(row => String(row.eventId)).filter(Boolean),
	)
	const fresh = fetched.filter(row => {
		const id = String(row.eventId)
		return id && !known.has(id)
	})
	if (!fresh.length) return { added: 0 }
	hubStore.messages.channelMessagesSource = sortChannelRows([...fresh, ...hubStore.messages.channelMessagesSource])
	return { added: fresh.length }
}

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId 目标 event id
 * @returns {Promise<object[]>} 消息行
 */
export async function fetchRowsForMessageEvent(groupId, channelId, eventId) {
	const norm = String(eventId || '').trim()
	if (!norm || !groupId || !channelId) return []
	const { messages } = await getChannelViewLogByEventIds(groupId, channelId, [norm])
	return Array.isArray(messages) ? messages : []
}

/**
 * 确保目标消息已载入 hubStore（必要时走 viewer eventIds 补拉）。
 * @param {string} eventId 消息 event id
 * @returns {Promise<{ ok: boolean, viewIndex: number, source: 'cache' | 'fetched' | 'missing' | 'no-channel' | 'fetch-error' | 'invalid' }>} 加载结果
 */
export async function ensureMessageLoaded(eventId) {
	const norm = String(eventId || '').trim()
	if (!norm) return { ok: false, viewIndex: -1, source: 'invalid' }

	const viewIndex = findMessageViewIndex(norm)
	if (viewIndex >= 0) return { ok: true, viewIndex, source: 'cache' }

	const groupId = hubStore.context.currentGroupId
	const channelId = hubStore.context.currentChannelId
	if (!groupId || !channelId) return { ok: false, viewIndex: -1, source: 'no-channel' }

	let rows = []
	try {
		rows = await fetchRowsForMessageEvent(groupId, channelId, norm)
	}
	catch {
		return { ok: false, viewIndex: -1, source: 'fetch-error' }
	}
	if (!rows.length) return { ok: false, viewIndex: -1, source: 'missing' }

	mergeRowsIntoSource(rows)
	return { ok: true, viewIndex: -1, source: 'fetched' }
}

/**
 * 合并增量 batch 进 source（保留 pending 行）。
 * @param {object[]} source 当前 source
 * @param {object[]} batch 新行
 * @param {string | null} composerPendingId 乐观 pending id
 * @returns {object[]} 合并后 source
 */
export function mergeIncrementalSourceBatch(source, batch, composerPendingId) {
	const byId = new Map()
	for (const row of source) {
		if (row.pending) continue
		const eventId = String(row.eventId)
		if (eventId) byId.set(eventId, row)
	}
	if (composerPendingId) {
		const pending = source.find(row => String(row.eventId) === composerPendingId)
		if (pending) byId.set(composerPendingId, pending)
	}
	for (const row of batch) {
		const eventId = String(row.eventId)
		if (!eventId) continue
		byId.set(eventId, row)
		if (composerPendingId && eventId !== composerPendingId)
			byId.delete(composerPendingId)
	}
	return sortChannelRows([...byId.values()])
}
