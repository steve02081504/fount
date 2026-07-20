/**
 * 【文件】public/hub/stream/connectionState.mjs
 * 【职责】当前群 WS 连接的可变句柄（供 connection / volatile 共享）。
 */

/** @type {WebSocket | null} */
export let groupWebSocket = null
/** @type {string | null} */
export let connectedGroupId = null
/** @type {string | null} */
export let activeChannelId = null

/**
 * @param {WebSocket | null} socket 当前套接字
 * @param {string | null} groupId 群 ID
 * @param {string | null} channelId 频道 ID
 * @returns {void}
 */
export function setConnectionHandles(socket, groupId, channelId) {
	groupWebSocket = socket
	connectedGroupId = groupId
	activeChannelId = channelId
}

/**
 * @param {string | null} channelId 活跃频道
 * @returns {void}
 */
export function setActiveChannelId(channelId) {
	activeChannelId = channelId
}
