/**
 * 【文件】materializeViewerLog.mjs — human/agent 对称的 viewer chat_log 物化
 * 【职责】readChannelMessages → hydrate → world/persona filter → 投影回频道行 DTO（view-log）。
 * 【原理】顺序固定：base → world（客观）→ persona（主观）。投影见 viewerLogProject.mjs。
 * 【数据结构】materializeViewerChatLog 返回 { entries, rawLines, viewer }；readViewerChannelMessages 返回 Hub DTO。
 * 【关联】viewerLog、viewerLogProject、hydration、group/queries、channelMessages view-log 路由。
 */
/** @typedef {import('../../../../../../../decl/chatLog.ts').chatLogEntry_t} chatLogEntry_t */
/** @typedef {import('../../../../../../../decl/chatLog.ts').chatViewer_t} chatViewer_t */

import { agentEntityHash } from '../../../../../../../scripts/p2p/entity_id.mjs'
import { readChannelMessagesForUser } from '../../group/queries.mjs'
import {
	buildChatLogEntriesFromChannelLines,
	loadDagHydrationI18n,
} from '../dag/hydration.mjs'
import { getState } from '../dag/materialize.mjs'
import { hydrateLogContextFromSidecar, sidecarChannelForEntry } from '../lib/contextSidecar.mjs'
import { getLocalNodeHash, getOperatorEntityHash } from '../lib/replica.mjs'


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
			? viewerFields.entityHash || agentEntityHash(getLocalNodeHash(), `chars/${viewerFields.charname}`)
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

	const world = await resolveWorld(groupId, channelId, username)
	const player = timeSlice.player

	/** @type {import('../../../../../../../decl/chatLog.ts').chatReplyRequest_t} */
	const arg = {
		chat_log: channelEntries,
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
 * view-log 主入口：物化 + 投影 + 准备 reactions 用的可见 eventIds。
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {{ since?: string, before?: string, limit?: string | number, eventIds?: string[] }} [pagination] 分页
 * @param {Partial<chatViewer_t> & Pick<chatViewer_t, 'kind'>} [viewerFields] 观察者（缺省本机 user）
 * @returns {Promise<{ messages: object[], visibleEventIds: string[] }>} Hub 兼容 DTO
 */
export async function readViewerChannelMessages(username, groupId, channelId, pagination = {}, viewerFields = { kind: 'user' }) {
	const { entries, rawLines } = await materializeViewerChatLog(username, groupId, channelId, viewerFields, pagination)
	const messages = projectViewerEntriesToRows(rawLines, entries)
	const visibleEventIds = messages
		.filter(row => row.type === 'message' && row.eventId)
		.map(row => String(row.eventId))
	return { messages, visibleEventIds }
}
