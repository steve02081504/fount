/**
 * 【文件】src/chat/auditLog.mjs
 * 【职责】为群管理 UI 提供「审计日志」分页查询：从本地 DAG 事件中筛选治理/ moderation 类事件并格式化为 i18n 友好条目。
 * 【原理】readJsonl 加载全量事件 → topologicalCanonicalOrder 拓扑排序 → authzFoldOrderIds 只保留当前治理分支（consensusBranchTip）
 *   → 过滤 AUDIT_LOG_EVENT_TYPES → 逆序（新→旧）分页。auditEventParams 从物化 state 解析频道名、角色名等展示字段。
 * 【数据结构】条目 { id, type, sender, at, channelId, params }；查询 q 支持 before 游标、offset/limit、types 过滤；默认 limit 50、上限 200。
 * 【关联】group 路由或 endpoints 调用 listAuditLogEntries；依赖 dag/materialize、dag/storage、p2p/governance_branch。
 */
import { topologicalCanonicalOrder } from '../../../../../../scripts/p2p/dag/index.mjs'
import { readJsonl } from '../../../../../../scripts/p2p/dag/storage.mjs'
import { GOVERNANCE_AUTHZ_TYPES } from '../../../../../../scripts/p2p/event_types.mjs'
import { authzFoldOrderIds } from '../../../../../../scripts/p2p/governance_branch.mjs'

import { getState } from './dag/materialize.mjs'
import { sanitizeFederatedEvent } from './events/wire.mjs'
import { eventsPath } from './lib/paths.mjs'

/** 管理员审计日志包含的 DAG 类型（治理 + 常见 moderation）。 */
export const AUDIT_LOG_EVENT_TYPES = new Set([
	...GOVERNANCE_AUTHZ_TYPES,
	'message_delete',
	'pin_message',
	'unpin_message',
	'file_upload',
	'file_delete',
])

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/**
 * @param {object} event DAG 事件
 * @param {object} state 物化群状态
 * @returns {Record<string, string | number | boolean>} i18n 插值参数
 */
function auditEventParams(event, state) {
	const content = event.content || {}
	const channelId = content.channelId || event.channelId || ''
	const roleId = content.roleId || ''
	const target = (
		content.targetPubKeyHash
		|| content.to
		|| content.targetEntityHash
		|| content.targetId
		|| ''
	).toLowerCase()
	const targetEventId = content.targetId || ''
	const claim = content.claim
	return {
		channelId,
		channelName: channelId ? state.channels[channelId]?.name || channelId : '',
		roleId,
		roleName: roleId ? state.roles[roleId]?.name || roleId : '',
		target,
		fileName: content.name || content.fileId || '',
		targetEventId: targetEventId ? `${targetEventId.slice(0, 12)}…` : '',
		claim: Number.isFinite(claim) ? claim : '',
		name: event.type === 'channel_update'
			? content.updates?.name || ''
			: content.name || state.groupMeta?.name || '',
		joinPolicy: content.joinPolicy || '',
	}
}

/**
 * @param {object} event DAG 事件
 * @param {object} state 物化群状态
 * @returns {object} 审计日志条目
 */
function toAuditEntry(event, state) {
	return {
		id: event.id,
		type: event.type,
		sender: (event.sender || '').toLowerCase(),
		at: event.hlc?.wall ?? 0,
		channelId: event.channelId || null,
		params: auditEventParams(event, state),
	}
}

/**
 * 构建审计日志行（新→旧）。
 * @param {string} username 本地账户
 * @param {string} groupId 群 ID
 * @param {string[] | undefined} types 类型过滤
 * @returns {Promise<{ rows: object[], state: object }>} 过滤后事件行与物化状态
 */
async function buildAuditRows(username, groupId, types) {
	const { state } = await getState(username, groupId)
	const events = await readJsonl(eventsPath(username, groupId), { sanitize: sanitizeFederatedEvent })
	const order = topologicalCanonicalOrder(events.map(event => ({
		id: event.id,
		prev_event_ids: event.prev_event_ids,
		hlc: event.hlc,
		node_id: event.node_id,
		sender: event.sender,
	})))
	const byId = new Map(events.map(event => [event.id, event]))
	const branchTip = state.consensusBranchTip ?? null
	const foldedIds = authzFoldOrderIds(order, byId, branchTip)
	const typeFilter = types?.length ? new Set(types) : null
	const rows = foldedIds
		.map(id => byId.get(id))
		.filter(event => event && AUDIT_LOG_EVENT_TYPES.has(event.type))
		.filter(event => !typeFilter || typeFilter.has(event.type))
		.reverse()
	return { rows, state }
}

/**
 * 分页列出群审计日志（仅采纳治理分支上的事件）。
 * @param {string} username 本地账户
 * @param {string} groupId 群 ID
 * @param {{ before?: string, offset?: number, limit?: number, types?: string[] }} [q] 游标/偏移与过滤
 * @returns {Promise<{ entries: object[], hasMore: boolean, total?: number }>} 分页条目、是否还有更多及总数
 */
export async function listAuditLogEntries(username, groupId, q = {}) {
	const { rows, state } = await buildAuditRows(username, groupId, q.types)
	const total = rows.length

	if (q.offset !== undefined || (q.limit !== undefined && !q.before)) {
		const offset = Math.max(0, Number(q.offset) || 0)
		const limitRaw = Number(q.limit)
		if (limitRaw === 0)
			return { entries: [], hasMore: offset < total, total }
		const limit = Math.min(Math.max(limitRaw || DEFAULT_LIMIT, 1), MAX_LIMIT)
		const page = rows.slice(offset, offset + limit)
		return {
			entries: page.map(event => toAuditEntry(event, state)),
			hasMore: offset + page.length < total,
			total,
		}
	}

	let work = rows
	const before = (q.before || '').toLowerCase()
	if (before) {
		const index = work.findIndex(event => event.id.toLowerCase() === before)
		work = index === -1 ? [] : work.slice(index + 1)
	}

	const limit = Math.min(Math.max(Number(q.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
	const slice = work.slice(0, limit + 1)
	const hasMore = slice.length > limit
	const page = hasMore ? slice.slice(0, limit) : slice

	return {
		entries: page.map(event => toAuditEntry(event, state)),
		hasMore,
		total,
	}
}
