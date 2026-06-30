/**
 * 【文件】public/src/wsUrl.mjs
 * 【职责】根据当前页面协议生成 ws/wss URL 与群 WebSocket 完整路径。
 * 【原理】wsProtocol 映射 https→wss；buildChatGroupWebSocketUrl 拼 ownerNodeHash 与 groupId。
 * 【数据结构】path 字符串、ownerNodeHash、groupId。
 * 【关联】groupWsClient.mjs；Hub 建连时调用。
 */
/**
 * @returns {'ws:' | 'wss:'} 与当前页面协议匹配的 WebSocket 协议
 */
export function wsProtocol() {
	return location.protocol === 'https:' ? 'wss:' : 'ws:'
}

/**
 * @param {string} path 以 `/` 开头的路径
 * @returns {string} 完整 WebSocket URL
 */
export function buildWebSocketUrl(path) {
	return `${wsProtocol()}//${location.host}${path}`
}

/**
 * @param {string} ownerNodeHash replica 节点 hash（64 hex）
 * @param {string} groupId 群 ID
 * @returns {string} 群聊 / 私聊共用 WS URL
 */
export function buildChatGroupWebSocketUrl(ownerNodeHash, groupId) {
	return buildWebSocketUrl(
		`/ws/parts/shells:chat/groups/${encodeURIComponent(ownerNodeHash)}/${encodeURIComponent(groupId)}`,
	)
}

/**
 * @param {string} roomId AV relay 房间 ID
 * @returns {string} 音视频中继 WS URL
 */
export function buildAvRelayWebSocketUrl(roomId) {
	return buildWebSocketUrl(`/ws/parts/shells:chat/av-relay/${encodeURIComponent(roomId)}`)
}
