import { geti18nForUser } from '../../../scripts/i18n/index.mjs'
import { sendEventToUser } from '../event_dispatcher.mjs'

import { sendWebPush } from './webPush.mjs'

/**
 * 向用户发送通知：优先存活 /ws/notify，其次 Web Push，均失败时回退桌面通知（点击打开 url）。
 * Web Push 可检测投递失败，故顺序回落而非并发。
 * @param {string} username 用户
 * @param {{ title?: string, body?: string, url?: string, tag?: string, icon?: string }} payload 通知载荷
 * @returns {Promise<void>}
 */
export async function notifyUser(username, payload = {}) {
	const title = payload.title || 'fount'
	const url = payload.url || '/'
	const icon = payload.icon || '/favicon.ico'
	const options = {
		body: payload.body || '',
		tag: payload.tag,
		icon,
		data: { url },
	}
	const sent = sendEventToUser(username, 'notification', { title, options, targetUrl: url })
	if (sent) return
	if (await sendWebPush(username, payload)) return
	try {
		const { notify } = await import('../../../scripts/notify.mjs')
		await notify(title, payload.body || '', { icon, open: url })
	}
	catch { /* 桌面通知不可用时静默 */ }
}

/**
 * 本地化通知：用 i18n 键解析标题 / 正文（缺失时回退字面值），再委托 notifyUser。
 * @param {string} username 用户
 * @param {{ titleKey?: string, titleParams?: object, title?: string, bodyKey?: string, bodyParams?: object, body?: string, url?: string, tag?: string, icon?: string }} payload 通知参数
 * @returns {Promise<void>}
 */
export async function notifyUserI18n(username, payload = {}) {
	/**
	 * 解析单个 i18n 键，失败回退字面值。
	 * @param {string} [key] 翻译键
	 * @param {object} [params] 插值参数
	 * @param {string} [fallback] 回退文本
	 * @returns {Promise<string|undefined>} 解析结果
	 */
	const resolve = async (key, params, fallback) => {
		if (!key) return fallback
		try {
			return await geti18nForUser(username, key, params || {})
		}
		catch {
			return fallback
		}
	}
	const title = await resolve(payload.titleKey, payload.titleParams, payload.title)
	const body = await resolve(payload.bodyKey, payload.bodyParams, payload.body)
	await notifyUser(username, { title, body, url: payload.url, tag: payload.tag, icon: payload.icon })
}
