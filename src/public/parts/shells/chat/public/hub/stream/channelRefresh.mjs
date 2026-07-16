/**
 * 【文件】public/hub/stream/channelRefresh.mjs
 * 【职责】主频道 / 子线程命中判定与增量刷新分发。
 */
import { hubStore } from '../core/state.mjs'
import { getActiveThreadChannelId, refreshActiveThreadIfOpen } from '../threadDrawer.mjs'

/**
 * @param {string | undefined} eventChannelId 事件频道
 * @param {string} mainChannelId 当前主频道
 * @returns {{ main: boolean, thread: boolean }} 是否命中
 */
export function hubChannelMatch(eventChannelId, mainChannelId) {
	const threadCh = getActiveThreadChannelId()
	if (!eventChannelId)
		return { main: true, thread: false }
	return {
		main: eventChannelId === mainChannelId,
		thread: !!threadCh && eventChannelId === threadCh,
	}
}

/**
 * @param {{ immediate?: boolean }} [options] 刷新选项
 * @returns {Promise<void>}
 */
async function refreshMainChannel(options = {}) {
	if (!hubStore.context.currentGroupId || !hubStore.context.currentChannelId) return
	const { scheduleChannelIncrementalRefresh } = await import('../messages/messages.mjs')
	scheduleChannelIncrementalRefresh(options)
}

/**
 * @param {string | undefined} eventChannelId 事件频道
 * @param {string} mainChannelId 主频道
 * @param {{ immediate?: boolean }} [options] 刷新选项
 * @returns {void}
 */
export function dispatchChannelIncrementalRefresh(eventChannelId, mainChannelId, options = {}) {
	const { main, thread } = hubChannelMatch(eventChannelId, mainChannelId)
	if (main) void refreshMainChannel(options)
	if (thread) void refreshActiveThreadIfOpen()
}

/**
 * @param {string | undefined} eventChannelId 事件频道
 * @param {string} mainChannelId 主频道
 * @returns {void}
 */
export function dispatchChannelOverlayRefresh(eventChannelId, mainChannelId) {
	const { main, thread } = hubChannelMatch(eventChannelId, mainChannelId)
	if (main) void refreshMainChannel()
	if (thread) void refreshActiveThreadIfOpen()
}

/**
 * @param {string} targetId 目标消息 eventId
 * @returns {Promise<void>}
 */
export async function dispatchChannelMessageEdit(targetId) {
	if (hubStore.context.currentGroupId && hubStore.context.currentChannelId) {
		const { applyChannelMessageEdit } = await import('../messages/messages.mjs')
		await applyChannelMessageEdit(targetId)
	}
	await refreshActiveThreadIfOpen()
}

/**
 * @param {string} targetId 目标消息 eventId
 * @returns {Promise<void>}
 */
export async function dispatchChannelMessageDelete(targetId) {
	if (hubStore.context.currentGroupId && hubStore.context.currentChannelId) {
		const { applyChannelMessageDelete } = await import('../messages/messages.mjs')
		await applyChannelMessageDelete(targetId)
	}
	await refreshActiveThreadIfOpen()
}
