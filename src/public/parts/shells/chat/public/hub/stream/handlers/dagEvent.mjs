/**
 * 【文件】public/hub/stream/handlers/dagEvent.mjs
 * 【职责】WS `dag_event`（频道结构 / 编辑删除 / overlay）。
 */
import { getGroupState } from '../../../src/api/groupCore.mjs'
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
