/**
 * Hub 频道消息 Store：source 合并、展示链折叠、导航补拉（无 DOM）。
 */
import {
	getChannelMessages,
	getPinContextMessages,
} from '../../src/api/groupApi.mjs'
import { mergeChannelMessagesForDisplay } from '../../src/lib/messageMerge.mjs'
import { compareHex64Asc } from '../../src/lib/pubKeyHex.mjs'
import { applyChannelDisplayChain } from '../../src/ui/channelDisplay.mjs'
import { hubStore } from '../core/state.mjs'

/**
 * @param {string | null} eventId 目标 eventId；null 清除
 * @returns {void}
 */
export function setPendingScrollTarget(eventId) {
	if (!eventId) {
		hubStore.pendingScrollTarget = null
		return
	}
	hubStore.pendingScrollTarget = {
		groupId: hubStore.currentGroupId,
		channelId: hubStore.currentChannelId,
		eventId: String(eventId).trim(),
	}
}

/**
 * @returns {string | null} 消费并清除待滚动锚点（群/频道不匹配则丢弃）
 */
export function consumePendingScrollTarget() {
	const target = hubStore.pendingScrollTarget
	hubStore.pendingScrollTarget = null
	if (!target?.eventId) return null
	if (target.groupId !== hubStore.currentGroupId) return null
	if (target.channelId !== hubStore.currentChannelId) return null
	return target.eventId
}

/**
 * @param {string} eventId 消息 event id
 * @returns {string} 规范化小写 id
 */
function normalizeEventId(eventId) {
	return String(eventId || '').trim().toLowerCase()
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
	let work = applyChannelDisplayChain(hubStore.channelMessagesSource)
	const q = hubStore.channelSearchQuery
	if (q && typeof messageTextFn === 'function')
		work = work.filter(row => messageTextFn(row).toLowerCase().includes(q))
	hubStore.channelMessages = mergeChannelMessagesForDisplay(work)
}

/**
 * @param {string} eventId 消息 event id
 * @returns {number} `channelMessages` 中的索引，未找到为 -1
 */
export function findMessageViewIndex(eventId) {
	const norm = normalizeEventId(eventId)
	if (!norm) return -1
	return hubStore.channelMessages.findIndex(
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
		hubStore.channelMessagesSource.map(row => String(row.eventId)).filter(Boolean),
	)
	const fresh = fetched.filter(row => {
		const id = String(row.eventId)
		return id && !known.has(id)
	})
	if (!fresh.length) return { added: 0 }
	hubStore.channelMessagesSource = sortChannelRows([...fresh, ...hubStore.channelMessagesSource])
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
	let rows = (await getPinContextMessages(groupId, channelId, norm)).messages || []
	if (!rows.some(row => String(row.eventId) === norm))
		rows = (await getChannelMessages(groupId, channelId, { eventIds: [norm] })).messages || []
	return rows
}

/**
 * 确保目标消息已载入 hubStore（必要时走 pin 邻域 / eventIds 补拉）。
 * @param {string} eventId 消息 event id
 * @returns {Promise<{ ok: boolean, viewIndex: number, source: 'cache' | 'fetched' | 'missing' | 'no-channel' | 'fetch-error' | 'invalid' }>} 加载结果
 */
export async function ensureMessageLoaded(eventId) {
	const norm = String(eventId || '').trim()
	if (!norm) return { ok: false, viewIndex: -1, source: 'invalid' }

	const viewIndex = findMessageViewIndex(norm)
	if (viewIndex >= 0) return { ok: true, viewIndex, source: 'cache' }

	const groupId = hubStore.currentGroupId
	const channelId = hubStore.currentChannelId
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
