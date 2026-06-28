import { escapeHtml } from '../lib/escapeHtml.mjs'
import { formatSocialProfileHref } from '../lib/runUri.mjs'

/**
 * 读取通知已读水位时间戳。
 * @param {object} appContext 应用上下文
 * @returns {number} 已读水位
 */
export function getNotificationsSeenAt(appContext) {
	return Number(localStorage.getItem(appContext.NOTIFICATIONS_SEEN_KEY)) || 0
}

/**
 * 标记通知已读并更新角标。
 * @param {object} appContext 应用上下文
 * @param {number} [at=Date.now()] 时间戳
 * @returns {void}
 */
export function markNotificationsSeen(appContext, at = Date.now()) {
	localStorage.setItem(appContext.NOTIFICATIONS_SEEN_KEY, String(at))
	void updateNotificationBadge(appContext)
}

/**
 * @param {string} type 通知类型
 * @returns {string} 图标 class
 */
function notificationIconClass(type) {
	if (type === 'reply') return 's-ic-notif-reply'
	if (type === 'mention') return 's-ic-notif-mention'
	if (type === 'like') return 's-ic-notif-like'
	if (type === 'follow') return 's-ic-notif-follow'
	return 's-ic-bell'
}

/**
 * 更新导航栏通知未读角标。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function updateNotificationBadge(appContext) {
	const data = await appContext.socialApi('/notifications?limit=50').catch(() => ({ notifications: [] }))
	const seenAt = getNotificationsSeenAt(appContext)
	const unread = (data.notifications || []).filter(row => row.at > seenAt).length
	const label = unread > 99 ? '99+' : String(unread)
	for (const badgeId of ['notificationsBadge', 'mobileNotificationsBadge']) {
		const badge = document.getElementById(badgeId)
		if (!badge) continue
		if (unread > 0) {
			badge.textContent = label
			badge.classList.remove('hidden')
		}
		else badge.classList.add('hidden')
	}
}

/**
 * 加载并渲染通知列表。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function loadNotifications(appContext) {
	const data = await appContext.socialApi('/notifications?limit=40')
	const container = document.getElementById('notificationsView')
	const toolbar = document.getElementById('notificationsToolbar')
	const seenAt = getNotificationsSeenAt(appContext)
	const rows = data.notifications || []
	container.querySelectorAll('.notification-card, .empty').forEach(node => node.remove())
	if (!rows.length) {
		if (toolbar) toolbar.classList.add('hidden')
		const empty = document.createElement('div')
		empty.className = 'empty'
		empty.textContent = appContext.geti18n('social.empty.notifications')
		container.appendChild(empty)
		markNotificationsSeen(appContext)
		return
	}
	if (toolbar) toolbar.classList.remove('hidden')
	for (const row of rows) {
		const card = document.createElement('article')
		card.className = `notification-card${row.at > seenAt ? ' unread' : ''}`
		const label = row.authorName || `${row.entityHash.slice(0, 8)}…`
		let message = ''
		if (row.type === 'reply') message = appContext.geti18n('social.notifications.reply', { author: label })
		else if (row.type === 'mention') message = appContext.geti18n('social.notifications.mention', { author: label })
		else if (row.type === 'like') message = appContext.geti18n('social.notifications.like', { author: label })
		else if (row.type === 'follow') message = appContext.geti18n('social.notifications.follow', { author: label })
		const href = row.postId
			? formatSocialProfileHref(row.entityHash, row.postId)
			: formatSocialProfileHref(row.entityHash)
		card.innerHTML = `
			<span class="notification-icon s-ic ${notificationIconClass(row.type)}" aria-hidden="true"></span>
			<div class="notification-body">
				<div class="post-header-row">
					${appContext.renderAvatarHtml(row.entityHash, { name: label })}
					<div>
						<div class="notification-type">${escapeHtml(message)}</div>
						<span class="post-meta">${escapeHtml(appContext.formatTime(row.at))}</span>
					</div>
				</div>
				${row.snippet ? `<p class="notification-snippet">${escapeHtml(row.snippet)}</p>` : ''}
				<a href="${escapeHtml(href)}" class="notification-view-link">${escapeHtml(appContext.geti18n('social.notifications.view'))}</a>
			</div>
		`
		container.appendChild(card)
	}
	markNotificationsSeen(appContext, rows.reduce((max, row) => Math.max(max, row.at || 0), 0) || Date.now())
	await updateNotificationBadge(appContext)
}
