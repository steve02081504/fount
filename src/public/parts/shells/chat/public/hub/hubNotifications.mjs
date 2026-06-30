/**
 * Hub 浏览器通知：页面在后台时对新频道/DAG 消息弹出 Notification。
 */
import { getMessageText } from './messages/messageRender.mjs'

/**
 * 请求通知权限（若尚未授权）。
 * @returns {void}
 */
export function setupHubNotifications() {
	if (window.Notification?.permission !== 'granted')
		void Notification.requestPermission()
}

/**
 * @param {object} [opts] 消息上下文
 * @param {string} [opts.groupName] 群名
 * @param {string} [opts.channelName] 频道名
 * @param {object} [opts.message] 频道消息行
 * @param {string | null} [opts.viewerPubKeyHash] 本机成员 hash
 * @returns {void}
 */
export function maybeNotifyHubMessage(opts = {}) {
	if (!document.hidden) return
	if (!window.Notification || Notification.permission !== 'granted') return

	const { groupName, channelName, message, viewerPubKeyHash } = opts
	if (!message) return

	const sender = (message.authorPubKeyHash || message.charId || '').toLowerCase()
	const viewer = (viewerPubKeyHash || '').toLowerCase()
	if (viewer && sender && viewer === sender) return

	const preview = getMessageText(message).trim().slice(0, 120)
		|| message.name
		|| message.charId
		|| ''
	if (!preview) return

	const titleParts = [groupName, channelName ? `#${channelName}` : ''].filter(Boolean)
	const title = titleParts.length ? titleParts.join(' · ') : 'fount chat'
	const tag = message.eventId ? `hub-msg:${message.eventId}` : undefined

	try {
		const notification = new Notification(title, {
			body: preview,
			tag,
			icon: '/favicon.ico',
		})
		/**
		 * 点击通知时聚焦窗口并关闭该条通知。
		 * @returns {void}
		 */
		notification.onclick = () => {
			window.focus()
			notification.close()
		}
	}
	catch {
		/* empty */
	}
}
