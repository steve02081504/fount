/**
 * Hub 跨标签/窗口入群通知（BroadcastChannel），供 protocolhandler 与 Hub 壳层同步侧栏。
 */

const CHANNEL_NAME = 'fount-chat-hub'

/** @type {BroadcastChannel | undefined} */
let channel

/**
 * @returns {BroadcastChannel} 懒创建频道
 */
function getChannel() {
	return channel ??= new BroadcastChannel(CHANNEL_NAME)
}

/**
 * 通知当前 Hub 标签页（及同源其他标签）用户已加入群组。
 * @param {string} groupId 群组 id
 */
export function broadcastHubGroupJoined(groupId) {
	const id = groupId.trim()
	if (!id) return
	getChannel().postMessage({ type: 'group-joined', groupId: id })
}

/**
 * 订阅跨标签入群事件。
 * @param {(groupId: string) => void} onJoined 回调
 * @returns {() => void} 取消订阅
 */
export function wireHubGroupJoinedListener(onJoined) {
	const broadcast = getChannel()
	/**
	 * @param {MessageEvent} event 频道消息
	 * @returns {void}
	 */
	const handler = (event) => {
		const data = event.data
		if (data?.type !== 'group-joined') return
		const groupId = String(data.groupId || '').trim()
		if (groupId) onJoined(groupId)
	}
	broadcast.addEventListener('message', handler)
	return () => broadcast.removeEventListener('message', handler)
}
