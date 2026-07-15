/**
 * 【文件】public/hub/stream/channelRefresh.mjs
 * 【职责】主频道 / 子线程命中判定与增量刷新分发。
 */
import { getActiveThreadChannelId } from '../threadDrawer.mjs'

import { streamCallbacks } from './callbacks.mjs'

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
 * @param {string | undefined} eventChannelId 事件频道
 * @param {string} mainChannelId 主频道
 * @param {{ immediate?: boolean }} [options] 刷新选项
 * @returns {void}
 */
export function dispatchChannelIncrementalRefresh(eventChannelId, mainChannelId, options = {}) {
	const { main, thread } = hubChannelMatch(eventChannelId, mainChannelId)
	if (main) void streamCallbacks.onChannelRefresh(options)
	if (thread) void streamCallbacks.onThreadChannelRefresh()
}

/**
 * @param {string | undefined} eventChannelId 事件频道
 * @param {string} mainChannelId 主频道
 * @returns {void}
 */
export function dispatchChannelOverlayRefresh(eventChannelId, mainChannelId) {
	const { main, thread } = hubChannelMatch(eventChannelId, mainChannelId)
	if (main) void streamCallbacks.onChannelRefresh()
	if (thread) void streamCallbacks.onThreadChannelRefresh()
}
