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
 * 更新导航栏通知未读角标。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function updateNotificationBadge(appContext) {
	const badge = document.getElementById('notificationsBadge')
	if (!badge) return
	const data = await appContext.socialApi('/notifications?limit=50').catch(() => ({ notifications: [] }))
	const seenAt = getNotificationsSeenAt(appContext)
	const unread = (data.notifications || []).filter(row => row.at > seenAt).length
	if (unread > 0) {
		badge.textContent = unread > 99 ? '99+' : String(unread)
		badge.classList.remove('hidden')
	}
	else badge.classList.add('hidden')
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
		const card = document.createElement('div')
		card.className = 'card notification-card'
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
			<div class="notification-row">
				<div class="post-header-row">
					${appContext.renderAvatarHtml(row.entityHash, { name: label })}
					<div>
						<span class="notification-type">${message}</span>
						<span class="post-meta">${appContext.formatTime(row.at)}</span>
					</div>
				</div>
			</div>
			${row.snippet ? `<p class="notification-snippet">${row.snippet}</p>` : ''}
			<a href="${href}" class="link-btn">${appContext.geti18n('social.notifications.view')}</a>
		`
		container.appendChild(card)
	}
	markNotificationsSeen(appContext, rows.reduce((max, row) => Math.max(max, row.at || 0), 0) || Date.now())
	await updateNotificationBadge(appContext)
}
