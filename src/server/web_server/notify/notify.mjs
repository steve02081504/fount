import { sendEventToUser } from '../event_dispatcher.mjs'
import { sendWebPush } from './webPush.mjs'

/**
 * 向用户发送通知：优先存活 /ws/notify，否则 Web Push。
 * @param {string} username 用户
 * @param {{ title?: string, body?: string, url?: string, tag?: string }} payload 通知载荷
 * @returns {Promise<void>}
 */
export async function notifyUser(username, payload = {}) {
	const title = payload.title || 'fount'
	const options = {
		body: payload.body || '',
		tag: payload.tag,
		icon: '/favicon.ico',
		data: { url: payload.url || '/' },
	}
	const sent = sendEventToUser(username, 'notification', {
		title,
		options,
		targetUrl: payload.url || '/',
	})
	if (sent) return
	await sendWebPush(username, payload)
}
