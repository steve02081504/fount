/**
 * 【文件】public/hub/stream/handlers/dagEvent.mjs
 * 【职责】WS `dag_event`（频道结构 / 成员 / 治理 / 编辑删除 / overlay）。
 */
import { getGroupState } from '../../../src/endpoints/groupCore.mjs'
import { store } from '../../core/state.mjs'
import {
	dispatchChannelMessageDelete,
	dispatchChannelMessageEdit,
	dispatchChannelOverlayRefresh,
	hubChannelMatch,
} from '../channelRefresh.mjs'
import {
	finishVolatileStreamPreview,
	hasVolatileStream,
	removeVolatileStream,
} from '../volatileSlots.mjs'

const OVERLAY_DAG_TYPES = new Set([
	'message_edit', 'message_delete', 'message_feedback',
	'reaction_add', 'reaction_remove', 'pin_message', 'unpin_message',
])

const CHANNEL_STRUCTURE_DAG_TYPES = new Set([
	'channel_create', 'channel_update', 'channel_delete',
])

/** 影响 `/state`（成员 / 治理 / 群设置 / 文件 / DAG 拓扑）的事件类型：命中后重取 `/state` 并刷新成员与横幅。 */
const STATE_REFRESH_DAG_TYPES = new Set([
	'member_join', 'member_leave', 'member_kick', 'member_ban', 'member_unban',
	'role_create', 'role_update', 'role_delete', 'role_assign', 'role_revoke',
	'group_settings_update', 'channel_permissions_update',
	'file_upload', 'file_delete', 'dag_tip_merge',
])

const STATE_REFRESH_DEBOUNCE_MS = 400

/** @type {Map<string, ReturnType<typeof setTimeout>>} 按群去重的 /state 重取定时器 */
const stateRefreshTimers = new Map()

/**
 * 防抖重取 `/state` 并刷新成员列表与状态横幅（隔离/同步横幅随之更新）。
 * @param {string} groupId 群 ID
 * @returns {void}
 */
function scheduleStateRefresh(groupId) {
	const existing = stateRefreshTimers.get(groupId)
	if (existing) clearTimeout(existing)
	stateRefreshTimers.set(groupId, setTimeout(() => {
		stateRefreshTimers.delete(groupId)
		void (async () => {
			try {
				store.context.currentState = await getGroupState(groupId)
				const { renderMemberList } = await import('../../sidebar/members.mjs')
				await renderMemberList(store.context.currentState)
				const { updateStatusBanners } = await import('../../banners.mjs')
				updateStatusBanners()
			}
			catch { /* empty */ }
		})()
	}, STATE_REFRESH_DEBOUNCE_MS))
}

/**
 * @param {object} wireMessage WS 载荷
 * @param {string} channelId 当前频道
 * @returns {boolean} 是否已处理
 */
export function handleDagEventWire(wireMessage, channelId) {
	if (wireMessage.type !== 'dag_event') return false

	const dagEvent = wireMessage.event
	const eventChannelId = dagEvent?.channelId
	const { main, thread } = hubChannelMatch(eventChannelId, channelId)
	if (eventChannelId && !main && !thread) return true

	if (CHANNEL_STRUCTURE_DAG_TYPES.has(dagEvent?.type) && store.context.currentGroupId) {
		void (async () => {
			try {
				store.context.currentState = await getGroupState(store.context.currentGroupId)
				const { renderHubChannelSidebar } = await import('../../sidebar/index.mjs')
				await renderHubChannelSidebar(store.context.currentState)
			}
			catch { /* empty */ }
		})()
		return true
	}
	if (STATE_REFRESH_DAG_TYPES.has(dagEvent?.type) && store.context.currentGroupId) {
		scheduleStateRefresh(store.context.currentGroupId)
		return true
	}
	if (dagEvent?.type === 'message_edit') {
		const targetId = String(dagEvent.content?.targetId || '')
		if (targetId) {
			if (hasVolatileStream(targetId))
				finishVolatileStreamPreview(targetId)
			void dispatchChannelMessageEdit(targetId, dagEvent.content || null)
		}
		return true
	}
	if (dagEvent?.type === 'message_delete') {
		const targetId = String(dagEvent.content?.targetId || '')
		if (targetId) {
			removeVolatileStream(targetId)
			void dispatchChannelMessageDelete(targetId)
		}
		return true
	}
	if (OVERLAY_DAG_TYPES.has(dagEvent?.type)) {
		dispatchChannelOverlayRefresh(eventChannelId, channelId)
		return true
	}
	return true
}
