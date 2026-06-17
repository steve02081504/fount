/**
 * 【文件】`dag/queries.mjs` — DAG/频道消息查询、同步与裁剪。
 * 【职责】分页 `syncEvents`、列出频道消息、checkpoint 后 prune `events.jsonl` 与消息内容保留、侧车 GC 等读路径。
 * 【原理】按拓扑序与 `syncScope` 过滤事件；频道消息 JSONL 可选 GSH 解密；保留策略结合 `groupSettings` 与 checkpoint tip 计算切片起点。
 * 【数据结构】`syncEvents` 返回 `{ events, truncated }`；prune 重写 `events.jsonl` 或各频道 `messages.jsonl`。
 * 【关联】`materialize.mjs`、`syncScope.mjs`、`storage.mjs`、`events/retention.mjs`。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { DEFAULT_MAX_CATCHUP_EVENTS } from '../../../../../../../scripts/p2p/constants.mjs'
import { topologicalCanonicalOrder } from '../../../../../../../scripts/p2p/dag/index.mjs'
import { readJsonl } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { memberChannelPermissions } from '../../../../../../../scripts/p2p/materialized_state.mjs'
import { stripDagEventLocalExtensions } from '../../../../../../../scripts/p2p/dag/strip_extensions.mjs'
import { resolveGroupChannelId } from '../lib/channelId.mjs'
import { gcLogContextSidecars } from '../lib/contextSidecar.mjs'
import { eventsPath, messagesPath, snapshotPath } from '../lib/paths.mjs'


import { withGroupWriteLock } from './groupLock.mjs'
import { getState, rebuildAndSaveCheckpoint } from './materialize.mjs'
import { eventMatchesLazyChannelScope } from './syncScope.mjs'

// ─── 同步 / 查询 ──────────────────────────────────────────────────────────────

/**
 * 分页返回 DAG 事件，供客户端增量同步与补拉。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {{ since?: string, limit?: number, channelId?: string }} q 游标 `since`、条数上限、可选 `channelId`
 * @returns {Promise<{ events: object[], truncated: boolean }>} 事件切片及是否因上限被截断
 */
export async function syncEvents(username, groupId, q) {
	const events = await readJsonl(eventsPath(username, groupId), { sanitize: stripDagEventLocalExtensions })
	let work = events
	const channelId = String(q.channelId || '').trim()
	if (channelId) {
		const { state } = await getState(username, groupId)
		const scope = state.channels?.[channelId]?.syncScope
		if (scope === 'channel') {
			const order = topologicalCanonicalOrder(events.map(dagEvent => ({
				id: dagEvent.id,
				prev_event_ids: dagEvent.prev_event_ids,
				hlc: dagEvent.hlc,
				node_id: dagEvent.node_id,
				sender: dagEvent.sender,
			})))
			const byId = new Map(events.map(dagEvent => [dagEvent.id, dagEvent]))
			work = order.map(id => byId.get(id)).filter(Boolean).filter(dagEvent => eventMatchesLazyChannelScope(dagEvent, channelId))
		}
	}
	const limit = Math.min(Number(q.limit) || DEFAULT_MAX_CATCHUP_EVENTS, DEFAULT_MAX_CATCHUP_EVENTS)
	if (!q.since) {
		const slice = work.slice(-limit)
		return { events: slice, truncated: work.length > limit }
	}
	const sinceIndex = work.findIndex(dagEvent => dagEvent.id === q.since)
	const slice = sinceIndex === -1 ? work : work.slice(sinceIndex + 1)
	return { events: slice.slice(0, limit), truncated: slice.length > limit }
}

/** 入群初始快照：每频道附带消息行上限 */
export const JOIN_CHANNEL_HISTORY_LIMIT = 2000

/**
 * @param {object} line 消息行
 * @returns {number} 用于保留策略的时间戳（毫秒）
 */
function messageLineWallMs(line) {
	return Number(line?.hlc?.wall ?? 0)
}

/**
 * 列出频道消息 JSONL 行（可选解密；供联邦快照与历史拉取）。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {{ before?: string, limit?: number, limitCap?: number, decrypt?: boolean, includeArchive?: boolean, fetchFromPeers?: boolean }} [q] 游标与上限
 * @returns {Promise<object[]>} 消息行
 */
export async function listChannelMessages(username, groupId, channelId, q = {}) {
	const lines = await readJsonl(messagesPath(username, groupId, channelId), { sanitize: stripDagEventLocalExtensions })
	if (q.includeArchive) {
		const { listArchiveMonthsForChannel } = await import('../archive/index.mjs')
		const { readArchiveAsMessageLines } = await import('../archive/reader.mjs')
		const months = await listArchiveMonthsForChannel(username, groupId, channelId)
		const archived = await readArchiveAsMessageLines(username, groupId, channelId, months)
		const known = new Set(lines.map(row => String(row.eventId).trim()))
		for (const row of archived) {
			const id = String(row.eventId).trim()
			if (id && !known.has(id)) {
				lines.push(row)
				known.add(id)
			}
		}
		lines.sort((a, b) => {
			const ta = messageLineWallMs(a)
			const tb = messageLineWallMs(b)
			if (ta !== tb) return ta - tb
			return String(a.eventId).localeCompare(String(b.eventId))
		})
	}
	const cap = Math.min(Number(q.limitCap) || 500, JOIN_CHANNEL_HISTORY_LIMIT)
	const limit = Math.min(Number(q.limit) || 200, cap)
	if (Array.isArray(q.eventIds) && q.eventIds.length) {
		const want = new Set(q.eventIds.map(id => String(id).trim()).filter(Boolean))
		const filtered = lines.filter(row => want.has(String(row.eventId).trim()))
		if (q.decrypt === false) return filtered
		const { decryptChannelMessageLines, isCkgEncryptedContent } = await import('../channel_keys/content.mjs')
		if (filtered.some(line => isCkgEncryptedContent(line?.content)))
			return decryptChannelMessageLines(username, groupId, channelId, filtered)
		return filtered
	}
	let slice
	if (!q.before) slice = lines.slice(-limit)
	else {
		const beforeNorm = String(q.before).trim().toLowerCase()
		const beforeIndex = lines.findIndex(line =>
			String(line.eventId).trim().toLowerCase() === beforeNorm,
		)
		slice = beforeIndex <= 0 ? [] : lines.slice(Math.max(0, beforeIndex - limit), beforeIndex)
	}
	if (!slice.length && q.before && q.fetchFromPeers !== false) {
		const { requestChannelHistoryFromPeers } = await import('../federation/channelHistory.mjs')
		const fetched = await requestChannelHistoryFromPeers(username, groupId, channelId, {
			before: q.before,
			limit,
		})
		if (fetched.length) {
			await mergeChannelHistoryRows(username, groupId, channelId, fetched)
			return listChannelMessages(username, groupId, channelId, { ...q, fetchFromPeers: false })
		}
	}
	if (q.decrypt !== false) {
		const { decryptChannelMessageLines, isCkgEncryptedContent } = await import('../channel_keys/content.mjs')
		if (slice.some(line => isCkgEncryptedContent(line?.content)))
			slice = await decryptChannelMessageLines(username, groupId, channelId, slice)
	}
	return slice
}

/**
 * 将远端频道历史行合并进本地 `messages/{channelId}.jsonl`（按 eventId 去重）。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object[]} incomingRows 待合并行
 * @returns {Promise<number>} 新写入条数
 */
export async function mergeChannelHistoryRows(username, groupId, channelId, incomingRows) {
	if (!Array.isArray(incomingRows) || !incomingRows.length) return 0
	const path = messagesPath(username, groupId, channelId)
	return withGroupWriteLock(username, groupId, async () => {
		const existing = await readJsonl(path, { sanitize: stripDagEventLocalExtensions })
		const known = new Set(
			existing.map(row => String(row.eventId).trim().toLowerCase()).filter(Boolean),
		)
		const toAdd = []
		for (const row of incomingRows) {
			const eventId = String(row.eventId).trim().toLowerCase()
			if (!eventId || known.has(eventId)) continue
			known.add(eventId)
			toAdd.push(row)
		}
		if (!toAdd.length) return 0
		const merged = [...existing, ...toAdd].sort((a, b) => {
			const ta = messageLineWallMs(a)
			const tb = messageLineWallMs(b)
			if (ta !== tb) return ta - tb
			return String(a.eventId).localeCompare(String(b.eventId), 'und')
		})
		await mkdir(dirname(path), { recursive: true })
		await writeFile(
			path,
			merged.map(JSON.stringify).join('\n') + (merged.length ? '\n' : ''),
			'utf8',
		)
		return toAdd.length
	})
}

/**
 * 合并多频道历史快照（入群 gossip 用）。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {Record<string, object[]>} channelHistories 频道 ID → 行数组
 * @returns {Promise<number>} 总新写入条数
 */
export async function mergeChannelHistories(username, groupId, channelHistories) {
	let total = 0
	for (const [channelId, rows] of Object.entries(channelHistories))
		total += await mergeChannelHistoryRows(username, groupId, channelId, rows)
	return total
}

/**
 * 按 `message_content_retention_ms` 裁某频道 messages JSONL（0 表示跳过）。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {number} cutoffWall 早于该 wall 时间的行删除
 * @returns {Promise<{ dropped: number, kept: number }>} 裁剪统计
 */
export async function pruneChannelMessagesJsonlByTime(username, groupId, channelId, cutoffWall) {
	const path = messagesPath(username, groupId, channelId)
	const lines = await readJsonl(path, { sanitize: stripDagEventLocalExtensions })
	if (!lines.length) return { dropped: 0, kept: 0 }
	const kept = lines.filter(line => messageLineWallMs(line) >= cutoffWall)
	const dropped = lines.length - kept.length
	if (dropped <= 0) return { dropped: 0, kept: kept.length }
	await withGroupWriteLock(username, groupId, async () => {
		await mkdir(dirname(path), { recursive: true })
		await writeFile(
			path,
			kept.map(JSON.stringify).join('\n') + (kept.length ? '\n' : ''),
			'utf8',
		)
	})
	return { dropped, kept: kept.length }
}

/**
 * 对所有频道应用消息正文保留策略。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @param {{ message_content_retention_ms?: unknown }} [groupSettings] 群设置
 * @returns {Promise<void>}
 */
export async function pruneAllChannelMessagesByRetention(username, groupId, groupSettings = {}) {
	const ms = Number(groupSettings.message_content_retention_ms) || 0
	if (ms <= 0) return
	const cutoffWall = Date.now() - ms
	const { state } = await getState(username, groupId)
	for (const channelId of Object.keys(state.channels))
		await pruneChannelMessagesJsonlByTime(username, groupId, channelId, cutoffWall)
	await gcLogContextSidecars(username, groupId)
}

/**
 * 压缩群：写 checkpoint、裁 events 后缀、可选按设置裁消息正文。
 * @param {string} username 用户名
 * @param {string} groupId 群 ID
 * @returns {Promise<{ eventsPruned: object, messageRetentionApplied: boolean }>} 压缩结果
 */
export async function compactGroup(username, groupId) {
	const { state } = await getState(username, groupId)
	await rebuildAndSaveCheckpoint(username, groupId)
	await pruneAllChannelMessagesByRetention(username, groupId, state.groupSettings)
	return {
		eventsPruned: { pruned: false, kept: 0, dropped: 0 },
		messageRetentionApplied: (Number(state.groupSettings?.message_content_retention_ms) || 0) > 0,
	}
}

/** 会话列表排序用：反映频道消息/互动活动的 DAG 类型。 */
const GROUP_LIST_ACTIVITY_TYPES = new Set([
	'message',
	'message_edit',
	'reaction_add',
	'reaction_remove',
	'pin_message',
	'unpin_message',
])

/**
 * 从本地 DAG 推算群最后消息活动时间（用于 `GET …/groups/list` 排序）。
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @returns {Promise<number>} 毫秒时间戳；无活动时为 0
 */
export async function computeLastGroupActivityMs(username, groupId) {
	const events = await readJsonl(eventsPath(username, groupId), { sanitize: stripDagEventLocalExtensions })
	let max = 0
	for (const ev of events) {
		if (!GROUP_LIST_ACTIVITY_TYPES.has(ev.type)) continue
		const t = Number(ev.hlc?.wall ?? 0)
		if (Number.isFinite(t) && t > max) max = t
	}
	return max
}

/**
 * 获取群组的默认频道 ID：优先 `groupSettings.defaultChannelId`，否则取首个频道或 `default`。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @returns {Promise<string>} 解析得到的默认频道 ID
 */
export async function getDefaultChannelId(username, groupId) {
	return resolveGroupChannelId(username, groupId, null)
}

/**
 * 基于物化状态查询某成员在指定频道的有效权限位图。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string} pubKeyHash 成员公钥哈希（64 位 hex）
 * @param {string} channelId 频道 ID
 * @returns {Promise<object>} 频道权限结构
 */
export async function getEffectivePermissions(username, groupId, pubKeyHash, channelId) {
	const { state } = await getState(username, groupId)
	return memberChannelPermissions(state, pubKeyHash, channelId)
}

/**
 * 仅裁剪某频道 `messages/{channelId}.jsonl` 派生日志，保留尾部若干行。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {number} keepLastN 保留尾部条数
 * @returns {Promise<void>}
 */
export async function pruneChannelMessagesJsonl(username, groupId, channelId, keepLastN) {
	const path = messagesPath(username, groupId, channelId)
	const lines = await readJsonl(path, { sanitize: stripDagEventLocalExtensions })
	const n = Math.max(0, Number(keepLastN) || 0)
	const kept = n ? lines.slice(-n) : []
	await withGroupWriteLock(username, groupId, async () => {
		await mkdir(dirname(path), { recursive: true })
		await writeFile(path, kept.map(JSON.stringify).join('\n') + (kept.length ? '\n' : ''), 'utf8')
	})
	await gcLogContextSidecars(username, groupId)
}

/**
 * 先写 checkpoint，再裁剪频道消息 JSONL，再按侧车可达性根做 `gcLogContextSidecars`。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {number} keepLastN 每条 JSONL 保留尾部条数
 * @returns {Promise<void>}
 */
export async function compactAndPruneChannelMessages(username, groupId, channelId, keepLastN) {
	const savedCheckpoint = await compactGroupCheckpoint(username, groupId)
	await pruneEventsJsonlAfterCheckpoint(username, groupId, savedCheckpoint)
	const path = messagesPath(username, groupId, channelId)
	const lines = await readJsonl(path, { sanitize: stripDagEventLocalExtensions })
	const gs = (await getState(username, groupId)).state?.groupSettings || {}
	const retentionMs = Number(gs.message_content_retention_ms) || 0
	let kept = lines
	if (retentionMs > 0) {
		const cutoffWall = Date.now() - retentionMs
		kept = kept.filter(line => messageLineWallMs(line) >= cutoffWall)
	}
	const n = Math.max(0, Number(keepLastN) || 0)
	if (n > 0) kept = kept.slice(-n)
	await withGroupWriteLock(username, groupId, async () => {
		await mkdir(dirname(path), { recursive: true })
		await writeFile(path, kept.map(JSON.stringify).join('\n') + (kept.length ? '\n' : ''), 'utf8')
	})
	await gcLogContextSidecars(username, groupId)
}

/**
 * 重写 checkpoint.json（裁剪 events 前应先调用以固化权限状态）。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @returns {Promise<object | null>} 新检查点或 null
 */
export async function compactGroupCheckpoint(username, groupId) {
	return rebuildAndSaveCheckpoint(username, groupId)
}

/**
 * 在已有带 `members_record` 的检查点前提下，将 `events.jsonl` 裁剪为拓扑序中自 `checkpoint_event_id` 起的后缀。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {object | null} [checkpointHint] 刚写入的检查点对象；不传则从磁盘读取
 * @returns {Promise<{ pruned: boolean, kept: number, dropped: number }>} 是否发生裁剪及条数统计
 */
export async function pruneEventsJsonlAfterCheckpoint(username, groupId, checkpointHint = null) {
	/** @type {object | null} */
	let checkpoint = checkpointHint
	if (!checkpoint)
		try {
			checkpoint = JSON.parse(await readFile(snapshotPath(username, groupId), 'utf8'))
		}
		catch {
			return { pruned: false, kept: 0, dropped: 0 }
		}

	const tipId = checkpoint?.checkpoint_event_id
	if (!tipId || !checkpoint?.members_record)
		return { pruned: false, kept: 0, dropped: 0 }

	const { pruneEventsJsonlAfterCheckpoint: pruneFile } = await import('../../../../../../../scripts/p2p/timeline/prune.mjs')
	return pruneFile(eventsPath(username, groupId), checkpoint, stripDagEventLocalExtensions)
}
