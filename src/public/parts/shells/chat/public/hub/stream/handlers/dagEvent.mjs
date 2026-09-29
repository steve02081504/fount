/**
 * 【文件】public/hub/stream/handlers/dagEvent.mjs
 * 【职责】WS `dag_event`（频道结构 / 成员 / 治理 / 编辑删除 / overlay）。
 */
import { store } from '../../core/state.mjs'
import {
	dispatchChannelMessageDelete,
	dispatchChannelMessageEdit,
	dispatchChannelOverlayRefresh,
	hubChannelMatch,
} from '../channelRefresh.mjs'
import { refreshGroupState } from '../stateRefresh.mjs'
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
	'group_meta_update', 'group_settings_update',
	'channel_permissions_update', 'group_permissions_update',
	'file_upload', 'file_delete', 'dag_tip_merge',
])

/** 需要额外重建频道侧栏 / 刷新 `channelCaps` 的权限与设置类事件。 */
const SIDEBAR_REFRESH_DAG_TYPES = new Set([
	'role_create', 'role_update', 'role_delete', 'role_assign', 'role_revoke',
	'group_meta_update', 'group_settings_update',
	'channel_permissions_update', 'group_permissions_update',
])

const STATE_REFRESH_DEBOUNCE_MS = 400

/** @type {Map<string, { timer: ReturnType<typeof setTimeout>, renderSidebar: boolean }>} 按群去重的 /state 重取定时器 */
const stateRefreshTimers = new Map()

/**
 * 防抖重取 `/state` 并刷新成员列表与状态横幅（隔离/同步横幅随之更新）；权限/设置类事件额外重建频道侧栏。
 * @param {string} groupId 群 ID
 * @param {{ renderSidebar?: boolean }} [options] 刷新选项
 * @returns {void}
 */
function scheduleStateRefresh(groupId, { renderSidebar = false } = {}) {
	const existing = stateRefreshTimers.get(groupId)
	if (existing) {
		clearTimeout(existing.timer)
		renderSidebar = renderSidebar || existing.renderSidebar
	}
	const timer = setTimeout(() => {
		stateRefreshTimers.delete(groupId)
		void (async () => {
			const state = await refreshGroupState(groupId, { renderSidebar })
			if (!state) return
			const { renderMemberList } = await import('../../sidebar/members.mjs')
			await renderMemberList(state)
			const { updateStatusBanners } = await import('../../banners.mjs')
			updateStatusBanners()
		})()
	}, STATE_REFRESH_DEBOUNCE_MS)
	stateRefreshTimers.set(groupId, { timer, renderSidebar })
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

	// 频道结构 / 状态类事件与频道无关（事件可能带其它频道 id）：先于频道过滤处理。
	if (CHANNEL_STRUCTURE_DAG_TYPES.has(dagEvent?.type) && store.context.currentGroupId) {
		scheduleStateRefresh(store.context.currentGroupId, { renderSidebar: true })
		return true
	}
	if (STATE_REFRESH_DAG_TYPES.has(dagEvent?.type) && store.context.currentGroupId) {
		scheduleStateRefresh(store.context.currentGroupId, { renderSidebar: SIDEBAR_REFRESH_DAG_TYPES.has(dagEvent?.type) })
		return true
	}

	const { main, thread } = hubChannelMatch(eventChannelId, channelId)
	if (eventChannelId && !main && !thread) return true

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
