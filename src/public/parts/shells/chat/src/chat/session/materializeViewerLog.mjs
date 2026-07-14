/**
 * 【文件】materializeViewerLog.mjs — human/agent 对称的 viewer chat_log 物化
 * 【职责】readChannelMessages → hydrate → visibility ACL → world/persona filter → 投影回频道行 DTO（view-log）。
 * 【原理】顺序固定：base（含 canViewMessage ACL，与 prompt_struct 对称）→ world（客观）→ persona（主观）。投影见 viewerLogProject.mjs。
 * 【数据结构】materializeViewerChatLog 返回 { entries, rawLines, viewer }；readViewerChannelMessages 返回 Hub DTO。
 * 【关联】viewerLog、viewerLogProject、hydration、group/queries、channelMessages view-log 路由。
 */
/** @typedef {import('../../../../../../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t */
/** @typedef {import('../../../../../../../decl/chatLog.ts').chatViewer_t} chatViewer_t */

import { ensureLocalAgentEntityHash } from '../../entity/member.mjs'
import { readChannelMessagesForUser } from '../../group/queries.mjs'
import {
	buildChatLogEntriesFromChannelLines,
	loadDagHydrationI18n,
} from '../dag/hydration.mjs'
import { getState } from '../dag/materialize.mjs'
import { hydrateLogContextFromSidecar, sidecarChannelForEntry } from '../lib/contextSidecar.mjs'
import { getOperatorEntityHash } from '../lib/replica.mjs'
import { entryVisibleToViewer } from '../lib/visibility.mjs'


import { resolveWorld } from './resolvePart.mjs'
import { getGroupRuntime } from './runtime.mjs'
import {
	applyPersonaChatLogView,
	applyWorldChatLogView,
	resolveViewerRoles,
} from './viewerLog.mjs'
import { projectViewerEntriesToRows } from './viewerLogProject.mjs'

/**
 * 物化 viewer 视角下的 chat_log（不投影 DTO）。
 * @param {string} username replica / 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {Partial<chatViewer_t> & Pick<chatViewer_t, 'kind'>} [viewerFields] 观察者字段（缺省为本机 user）
 * @param {{ since?: string, before?: string, limit?: string | number, eventIds?: string[] }} [pagination] 分页（同 readChannelMessagesForUser）
 * @returns {Promise<{ entries: chatLogEntry_t[], rawLines: object[], viewer: chatViewer_t }>} 视图化条目 + 原始行
 */
export async function materializeViewerChatLog(username, groupId, channelId, viewerFields = { kind: 'user' }, pagination = {}) {
	const chatMetadata = await getGroupRuntime(groupId, username)
	const timeSlice = chatMetadata.LastTimeSlice
	const { state } = await getState(username, groupId)

	const member_roles = viewerFields.roles
		?? await resolveViewerRoles(state, {
			charname: viewerFields.charname,
			replicaUsername: username,
			groupId,
		})

	const memberId = viewerFields.memberId
		?? (viewerFields.kind === 'char' && viewerFields.charname
			? viewerFields.entityHash || await ensureLocalAgentEntityHash(username, viewerFields.charname)
			: await getOperatorEntityHash(username))

	/** @type {chatViewer_t} */
	const viewer = {
		kind: viewerFields.kind,
		memberId: memberId || '',
		ownerUsername: viewerFields.ownerUsername || username,
		channelId,
		...viewerFields.charname && { charname: viewerFields.charname },
		...viewerFields.entityHash && { entityHash: viewerFields.entityHash },
		roles: member_roles,
	}

	const rawLines = await readChannelMessagesForUser(username, groupId, channelId, pagination)
	const i18n = await loadDagHydrationI18n(username)
	const channelEntries = await buildChatLogEntriesFromChannelLines(
		rawLines,
		timeSlice,
		i18n,
		channelId,
		username,
		groupId,
	)

	for (const logEntry of channelEntries)
		await hydrateLogContextFromSidecar(
			username,
			groupId,
			sidecarChannelForEntry(logEntry, channelId),
			logEntry,
		)

	// base 层 visibility ACL：与 prompt_struct 的 entryVisibleForPrompt 对称（agent LLM 视图与 human view-log 同规则）
	const aclViewer = { memberId: viewer.memberId, roles: member_roles, charId: viewer.charname }
	const visibleEntries = channelEntries.filter(entry => entryVisibleToViewer(entry, aclViewer))

	const world = await resolveWorld(groupId, channelId, username)
	const player = timeSlice.player

	/** @type {import('../../../../../../../decl/chatLog.ts').chatReplyRequest_t} */
	const arg = {
		chat_log: visibleEntries,
		world,
		user: player,
		member_roles,
		extension: {
			groupId,
			channelId,
			memberId: viewer.memberId,
			member_roles,
		},
	}

	arg.chat_log = await applyWorldChatLogView(arg, viewer)
	arg.chat_log = await applyPersonaChatLogView(arg, viewer)

	return { entries: arg.chat_log, rawLines, viewer }
}

/**
 * 解析 view-log 分页 limit（与 readChannelMessagesForUser 一致）。
 * @param {string | number | undefined} rawLimit query limit
 * @returns {number} 有效 page limit，1–500
 */
function resolveViewerPageLimit(rawLimit) {
	const messageLimit = rawLimit != null && rawLimit !== '' ? Number(rawLimit) : undefined
	return Number.isFinite(messageLimit) && messageLimit > 0
		? Math.min(messageLimit, 500)
		: 200
}

/**
 * view-log 主入口：物化 + 投影 + 准备 reactions 用的可见 eventIds。
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {{ since?: string, before?: string, limit?: string | number, eventIds?: string[] }} [pagination] 分页
 * @param {Partial<chatViewer_t> & Pick<chatViewer_t, 'kind'>} [viewerFields] 观察者（缺省本机 user）
 * @returns {Promise<{ messages: object[], visibleEventIds: string[], hasMore: boolean, oldestRawEventId: string | null }>} Hub 兼容 DTO
 */
export async function readViewerChannelMessages(username, groupId, channelId, pagination = {}, viewerFields = { kind: 'user' }) {
	const pageLimit = resolveViewerPageLimit(pagination.limit)
	const { entries, rawLines } = await materializeViewerChatLog(username, groupId, channelId, viewerFields, pagination)
	const messages = projectViewerEntriesToRows(rawLines, entries)
	const visibleEventIds = messages
		.filter(row => row.type === 'message' && row.eventId)
		.map(row => String(row.eventId))
	const oldestRawEventId = rawLines[0]?.eventId ? String(rawLines[0].eventId) : null
	const hasMore = rawLines.length >= pageLimit
	return { messages, visibleEventIds, hasMore, oldestRawEventId }
}
