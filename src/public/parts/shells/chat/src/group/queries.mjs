/**
 * 【文件】group/queries.mjs
 * 【职责】群侧栏列表、频道消息读取与 reaction 事件查询，为 HTTP/Hub 提供聚合读模型。
 * 【原理】遍历 userGroups 物化 state 过滤本机活跃成员；读 messages.jsonl 后 merge、解密、分页并解析 content_ref；为查看者附加 isRemote/authorPubKeyHash。
 * 【数据结构】群列表行、消息行（eventId/content/charId）、reaction 精简事件、分页参数 since/before/limit。
 * 【关联】被 group/routes/groups.mjs、channels.mjs 调用；依赖 chat/dag、chat/file_keys、messageMerge、access.mjs。
 */
import { stat } from 'node:fs/promises'

import { DEFAULT_STREAM_GENERATING_IDLE_MS } from 'npm:@steve02081504/fount-p2p/core/constants'
import { readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'

import { mergeChannelMessagesForDisplay } from '../../public/shared/messageMerge.mjs'
import { materializeFromCheckpoint } from '../chat/dag/groupMaterializedState.mjs'
import { getState } from '../chat/dag/materialize.mjs'
import { resolveContentRefsInMessageLines } from '../chat/files/contentRefResolve.mjs'
import { safeReadJson } from '../chat/lib/fsSafe.mjs'
import { eventsPath, snapshotPath } from '../chat/lib/paths.mjs'
import { loadReadMarkers, summarizeGroupUnread } from '../chat/lib/readMarkers.mjs'
import { listUserGroups } from '../chat/lib/userGroups.mjs'
import { tallyVoteChoices } from '../chat/lib/voteTally.mjs'

import { resolveActiveMemberKeyForLocalReplica, resolveActiveMemberKeyForLocalUser } from './access.mjs'

/**
 * 群列表用轻量物化：有 snapshot 时避免全量重放 events.jsonl。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} 物化 state
 */
async function loadGroupListState(username, groupId) {
	const checkpoint = await safeReadJson(snapshotPath(username, groupId))
	if (checkpoint?.members_record) {
		const fromCheckpoint = materializeFromCheckpoint(checkpoint)
		if (await resolveActiveMemberKeyForLocalUser(username, groupId, fromCheckpoint))
			return fromCheckpoint
	}
	const { state } = await getState(username, groupId, { skipLeftPurge: true })
	return state
}

/**
 * 侧栏排序用最近活动时间（读 events.jsonl mtime，避免扫描全文件）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<number>} 毫秒时间戳
 */
async function lastGroupListActivityMs(username, groupId) {
	const checkpoint = await safeReadJson(snapshotPath(username, groupId))
	if (Number.isFinite(checkpoint?.last_activity_ms))
		return checkpoint.last_activity_ms
	try {
		const st = await stat(eventsPath(username, groupId))
		return st.mtimeMs
	}
	catch {
		return 0
	}
}

/**
 * 为频道消息行附加 §17 展示字段：`isRemote`、`authorPubKeyHash`。
 * @param {object[]} lines 解密后的消息行
 * @param {string} viewerPubKeyHash 当前查看者成员键
 * @returns {object[]} 带展示元数据的消息行
 */
function enrichChannelMessagesForViewer(lines, viewerPubKeyHash) {
	const localMemberKey = viewerPubKeyHash.trim().toLowerCase()
	return lines.map(line => {
		const authorPubKeyHash = line.sender.trim().toLowerCase()
		return {
			...line,
			charId: line.charId || null,
			charOwner: line.content?.charOwner || null,
			authorPubKeyHash,
			isRemote: !!(authorPubKeyHash && authorPubKeyHash !== localMemberKey),
		}
	})
}

/**
 * 占位 `message` 超时未收到 `message_edit` 终稿时标记失败（§6.4）。
 * @param {object[]} lines 消息行（时间顺序）
 * @param {number} [idleMs] `streamGeneratingIdleMs` 阈值
 * @returns {object[]} 带 `streamGenerationFailed` 标记的副本
 */
function markStaleGeneratingMessages(lines, idleMs = DEFAULT_STREAM_GENERATING_IDLE_MS) {
	if (!lines.length) return lines
	const now = Date.now()
	const thresholdMs = idleMs > 0 ? idleMs : DEFAULT_STREAM_GENERATING_IDLE_MS
	return lines.map(line => {
		if (line.type !== 'message' || !line.content?.is_generating) return line
		if (line.timestamp && now - line.timestamp > thresholdMs)
			return { ...line, content: { ...line.content, is_generating: false, streamGenerationFailed: true } }
		return line
	})
}

/**
 * @param {string} username 用户名
 * @param {string} entityHash 实体（私有未读水位归属）
 * @returns {Promise<object[]>} 群列表行
 */
export async function enumerateJoinedFederatedGroups(username, entityHash) {
	const readMarkers = loadReadMarkers(username, entityHash)
	const rows = []
	for (const groupId of await listUserGroups(username)) {
		const state = await loadGroupListState(username, groupId)
		if (!await resolveActiveMemberKeyForLocalUser(username, groupId, state)) continue
		const { unreadCount, channelUnread } = summarizeGroupUnread(state, readMarkers[groupId] || {})
		rows.push({
			groupId,
			name: state.groupMeta?.name || groupId,
			description: state.groupMeta?.description ?? '',
			avatar: state.groupMeta?.avatar ?? null,
			defaultChannelId: state.groupSettings?.defaultChannelId ?? null,
			memberCount: Object.values(state.members).filter(member => member?.status === 'active').length,
			channelCount: Object.keys(state.channels).length,
			lastMessageTime: await lastGroupListActivityMs(username, groupId),
			friendBinding: state.groupMeta?.friendBinding || null,
			unreadCount,
			channelUnread,
		})
	}

	return rows
}

/**
 * 从物化 overlay 聚合当前页消息的反应计票。
 * @param {object} state 物化群状态
 * @param {string} channelId 频道 ID
 * @param {string[]} messageEventIds 当前页 message eventId
 * @returns {Record<string, Record<string, { voters: string[] }>>} targetEventId → emoji → 投票者
 */
export function aggregateReactionsForMessages(state, channelId, messageEventIds) {
	const reactions = state?.messageOverlay?.reactions
	if (!(reactions instanceof Map) || !reactions.size || !messageEventIds?.length) return {}
	const senderIndex = state.messageSenderIndex || {}
	const targetSet = new Set(messageEventIds.map(id => String(id).trim()).filter(Boolean))
	/** @type {Record<string, Record<string, { voters: string[] }>>} */
	const out = {}
	for (const [key, voters] of reactions) {
		const sepIdx = key.indexOf(':')
		if (sepIdx <= 0) continue
		const targetId = key.slice(0, sepIdx)
		const emoji = key.slice(sepIdx + 1)
		if (!emoji || !voters?.size || !targetSet.has(targetId)) continue
		const indexed = senderIndex[targetId] || senderIndex[targetId.toLowerCase()]
		if ((indexed?.channelId || 'default') !== channelId) continue
		if (!out[targetId]) out[targetId] = {}
		out[targetId][emoji] = { voters: [...voters] }
	}
	return out
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string[]} messageEventIds 当前页 message eventId
 * @returns {Promise<Record<string, Record<string, { voters: string[] }>>>} 聚合反应
 */
export async function readChannelReactionsForMessages(username, groupId, channelId, messageEventIds) {
	const { state } = await getState(username, groupId)
	return aggregateReactionsForMessages(state, channelId, messageEventIds)
}

/**
 * @param {object[]} lines 消息行
 * @param {object[]} voteCastEvents vote_cast 事件
 * @returns {Promise<object[]>} 带 voteSummary 的行
 */
async function attachVoteSummaries(lines, voteCastEvents) {
	const hasBallot = lines.some(line => Array.isArray(line.content?.options))
	if (!hasBallot || !voteCastEvents.length) return lines
	const merged = [...lines, ...voteCastEvents]
	return lines.map(line => {
		if (!Array.isArray(line.content?.options)) return line
		const counts = tallyVoteChoices(merged, line.eventId)
		return {
			...line,
			extension: {
				...line.extension,
				voteSummary: Object.fromEntries(counts),
			},
		}
	})
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} state 物化状态
 * @param {object[]} lines 消息行
 * @param {string} [channelId] 频道 ID
 * @returns {Promise<object[]>} enriched 消息行
 */
async function finalizeChannelMessagesForViewer(username, groupId, state, lines, channelId = 'default') {
	const viewerPubKeyHash = await resolveActiveMemberKeyForLocalReplica(username, groupId, state)
	if (!viewerPubKeyHash) throw new Error('Not a member')
	const streamGeneratingIdleMs = Number(state.groupSettings?.streamGeneratingIdleMs)
	let work = markStaleGeneratingMessages(
		lines,
		Number.isFinite(streamGeneratingIdleMs) && streamGeneratingIdleMs > 0 ? streamGeneratingIdleMs : undefined,
	)
	if (work.some(line => Array.isArray(line.content?.options))) {
		const events = await readJsonl(eventsPath(username, groupId), { sanitize: stripDagEventLocalExtensions })
		const voteCastEvents = events
			.filter(event => event.type === 'vote_cast' && (event.channelId || 'default') === channelId)
			.map(event => ({
				type: event.type,
				sender: event.sender,
				content: event.content,
				eventId: event.id,
				timestamp: event.hlc?.wall,
			}))
		work = await attachVoteSummaries(work, voteCastEvents)
	}
	return enrichChannelMessagesForViewer(
		await resolveContentRefsInMessageLines(username, work),
		viewerPubKeyHash,
	)
}

/**
 * 读取频道消息 JSONL、解密、折叠 append 链并解析 content_ref。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {{ since?: string, before?: string, limit?: string | number, eventIds?: string[] }} [pagination] 分页参数
 * @returns {Promise<object[]>} 消息行对象数组
 */
export async function readChannelMessagesForUser(username, groupId, channelId, pagination = {}) {
	const { state } = await getState(username, groupId)
	const { listChannelMessages, JOIN_CHANNEL_HISTORY_LIMIT } = await import('../chat/dag/queries.mjs')
	const messageLimit = pagination.limit != null && pagination.limit !== ''
		? Number(pagination.limit) : undefined
	const pageLimit = Number.isFinite(messageLimit) && messageLimit > 0
		? Math.min(messageLimit, 500)
		: 200
	const scanLimit = pagination.since
		? Math.min(500, JOIN_CHANNEL_HISTORY_LIMIT)
		: pageLimit

	if (Array.isArray(pagination.eventIds) && pagination.eventIds.length) {
		let lines = await listChannelMessages(username, groupId, channelId, {
			includeArchive: true,
			decrypt: true,
			eventIds: pagination.eventIds,
			fetchFromPeers: true,
		})
		if (lines.length < pagination.eventIds.length) {
			const { requestChannelHistoryFromPeers } = await import('../chat/federation/channelHistory.mjs')
			await requestChannelHistoryFromPeers(username, groupId, channelId, { limit: 500 })
			lines = await listChannelMessages(username, groupId, channelId, {
				includeArchive: true,
				decrypt: true,
				eventIds: pagination.eventIds,
				fetchFromPeers: false,
			})
		}
		lines = mergeChannelMessagesForDisplay(lines)
		return finalizeChannelMessagesForViewer(username, groupId, state, lines, channelId)
	}

	let lines
	if (pagination.before && !pagination.since) {
		lines = await listChannelMessages(username, groupId, channelId, {
			includeArchive: true,
			decrypt: true,
			before: pagination.before,
			limit: pageLimit,
			fetchFromPeers: true,
		})
		lines = mergeChannelMessagesForDisplay(lines)
		return finalizeChannelMessagesForViewer(username, groupId, state, lines, channelId)
	}

	lines = await listChannelMessages(username, groupId, channelId, {
		includeArchive: true,
		decrypt: true,
		limit: scanLimit,
		fetchFromPeers: true,
	})
	lines = mergeChannelMessagesForDisplay(lines)
	if (pagination.since) {
		const sinceIndex = lines.findIndex(message => message.eventId === pagination.since)
		if (sinceIndex !== -1) lines = lines.slice(sinceIndex)
	}
	if (pagination.before) {
		const beforeIndex = lines.findIndex(message => message.eventId === pagination.before)
		if (beforeIndex !== -1) lines = lines.slice(0, beforeIndex)
	}
	if (Number.isFinite(messageLimit) && messageLimit > 0) lines = lines.slice(-messageLimit)
	return finalizeChannelMessagesForViewer(username, groupId, state, lines, channelId)
}

/**
 * 读取 pin ±N 邻域消息（checkpoint hot_posts.pinContexts + 冷归档）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} pinEventId 置顶消息 eventId
 * @returns {Promise<object[]>} 邻域消息行
 */
export async function readPinNeighborhoodForUser(username, groupId, channelId, pinEventId) {
	const checkpoint = await safeReadJson(snapshotPath(username, groupId))
	const pinNorm = String(pinEventId).trim().toLowerCase()
	let eventIds = checkpoint?.hot_posts?.pinContexts?.[channelId]?.[pinNorm]
	if (!eventIds || eventIds.length <= 1) {
		const { state } = await getState(username, groupId)
		const { archiveSettingsFromGroup } = await import('../chat/archive/settings.mjs')
		const { listChannelMessages } = await import('../chat/dag/queries.mjs')
		const pinContext = archiveSettingsFromGroup(state.groupSettings).pinContext
		const all = await listChannelMessages(username, groupId, channelId, {
			includeArchive: true,
			decrypt: false,
			fetchFromPeers: false,
			limitCap: 50_000,
			limit: 50_000,
		})
		const idx = all.findIndex(row => String(row.eventId).trim().toLowerCase() === pinNorm)
		if (idx >= 0) {
			const start = Math.max(0, idx - pinContext)
			const end = Math.min(all.length, idx + pinContext + 1)
			eventIds = all.slice(start, end).map(row => row.eventId)
		}
		else eventIds = [pinEventId]
	}
	return readChannelMessagesForUser(username, groupId, channelId, { eventIds })
}
