/**
 * 【文件】public/src/hubBroadcast.mjs
 * 【职责】Hub 跨标签/窗口入群通知（BroadcastChannel），供 protocolhandler 与 Hub 壳层同步侧栏。
 */

const CHANNEL_NAME = 'fount-chat-hub'

/** @type {BroadcastChannel | null} */
let channel = null

/**
 * @returns {BroadcastChannel | null} 懒创建频道；不支持时 null
 */
function getChannel() {
	if (typeof BroadcastChannel === 'undefined') return null
	if (!channel) channel = new BroadcastChannel(CHANNEL_NAME)
	return channel
}

/**
 * 通知当前 Hub 标签页（及同源其他标签）用户已加入群组。
 * @param {string} groupId 群组 id
 */
export function broadcastHubGroupJoined(groupId) {
	const id = String(groupId || '').trim()
	if (!id) return
	const ch = getChannel()
	if (!ch) return
	ch.postMessage({ type: 'group-joined', groupId: id })
}

/**
 * 订阅跨标签入群事件。
 * @param {(groupId: string) => void} onJoined 回调
 * @returns {() => void} 取消订阅
 */
export function wireHubGroupJoinedListener(onJoined) {
	const ch = getChannel()
	if (!ch) return () => {}
	/**
	 * @param {MessageEvent} event 频道消息
	 * @returns {void}
	 */
	const handler = (event) => {
		const data = event?.data
		if (data?.type !== 'group-joined') return
		const groupId = String(data.groupId || '').trim()
		if (groupId) onJoined(groupId)
	}
	ch.addEventListener('message', handler)
	return () => ch.removeEventListener('message', handler)
}
