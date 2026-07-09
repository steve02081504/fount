import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { formatSocialProfileHref } from '/parts/shells:chat/shared/socialRunUri.mjs'

import { bindInfiniteScroll, disconnectInfiniteScroll, ensureScrollSentinel } from '../lib/infiniteScroll.mjs'

/** @type {number | null} */
let badgeUnreadCount = null

/** @type {boolean} */
let notificationsLoading = false

/**
 * 确保已读水位已自服务端加载。
 * @param {object} appContext 应用上下文
 * @returns {Promise<number>} 已读水位
 */
export async function ensureNotificationsSeenAt(appContext) {
	if (Number.isFinite(appContext.state.notificationsSeenAt))
		return appContext.state.notificationsSeenAt
	const data = await appContext.socialApi('/notifications/seen').catch(() => ({ seenAt: 0 }))
	appContext.state.notificationsSeenAt = Number(data.seenAt) || 0
	return appContext.state.notificationsSeenAt
}

/**
 * 读取通知已读水位时间戳（内存缓存）。
 * @param {object} appContext 应用上下文
 * @returns {number} 已读水位
 */
export function getNotificationsSeenAt(appContext) {
	return Number(appContext.state.notificationsSeenAt) || 0
}

/**
 * 标记通知已读并更新角标。
 * @param {object} appContext 应用上下文
 * @param {number} [at=Date.now()] 时间戳
 * @returns {Promise<void>}
 */
export async function markNotificationsSeen(appContext, at = Date.now()) {
	await appContext.socialApi('/notifications/seen', {
		method: 'PUT',
		body: JSON.stringify({ at }),
	})
	appContext.state.notificationsSeenAt = at
	badgeUnreadCount = 0
	await updateNotificationBadge(appContext)
}

/**
 * @param {string} type 通知类型
 * @returns {string} 图标 class
 */
function notificationIconClass(type) {
	if (type === 'reply') return 's-ic-notif-reply'
	if (type === 'mention') return 's-ic-notif-mention'
	if (type === 'like') return 's-ic-notif-like'
	if (type === 'repost') return 's-ic-notif-repost'
	if (type === 'follow') return 's-ic-notif-follow'
	return 's-ic-bell'
}

/**
 * 更新导航栏通知未读角标。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function updateNotificationBadge(appContext) {
	const data = await appContext.socialApi('/notifications?limit=1').catch(() => ({ unreadCount: 0 }))
	const unread = Number.isFinite(badgeUnreadCount)
		? badgeUnreadCount
		: Number(data.unreadCount) || 0
	badgeUnreadCount = null
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
 * WS 推送通知时递增 badge（避免整页拉 /notifications）。
 * @param {object} appContext 应用上下文
 * @returns {void}
 */
export function bumpNotificationBadge(appContext) {
	const current = badgeUnreadCount ?? appContext.state.lastNotificationUnreadCount ?? 0
	badgeUnreadCount = current + 1
	appContext.state.lastNotificationUnreadCount = badgeUnreadCount
	void updateNotificationBadge(appContext)
}

/**
 * 通知条目跳转链接。
 * @param {object} appContext 应用上下文
 * @param {object} row 通知条目
 * @returns {string} profile 链接
 */
function notificationHref(appContext, row) {
	if (row.type === 'reply' || row.type === 'mention')
		return formatSocialProfileHref(row.actorEntityHash, row.postId)
	if ((row.type === 'like' || row.type === 'repost') && row.targetPostId && appContext.state.viewerEntityHash)
		return formatSocialProfileHref(appContext.state.viewerEntityHash, row.targetPostId)
	return formatSocialProfileHref(row.actorEntityHash)
}

/**
 * 渲染单条通知卡片。
 * @param {object} appContext 应用上下文
 * @param {object} row 通知条目
 * @param {number} seenAt 已读水位
 * @returns {HTMLElement} 卡片
 */
function renderNotificationCard(appContext, row, seenAt) {
	const card = document.createElement('article')
	card.className = `notification-card${row.at > seenAt ? ' unread' : ''}`
	const label = appContext.authorLabel(row.actorEntityHash)
	let message = ''
	if (row.type === 'reply') message = appContext.geti18n('social.notifications.reply', { author: label })
	else if (row.type === 'mention') message = appContext.geti18n('social.notifications.mention', { author: label })
	else if (row.type === 'like') message = appContext.geti18n('social.notifications.like', { author: label })
	else if (row.type === 'repost') message = appContext.geti18n('social.notifications.repost', { author: label })
	else if (row.type === 'follow') message = appContext.geti18n('social.notifications.follow', { author: label })
	const href = notificationHref(appContext, row)
	card.innerHTML = `
		<span class="notification-icon s-ic ${notificationIconClass(row.type)}" aria-hidden="true"></span>
		<div class="notification-body">
			<div class="post-header-row">
				${appContext.renderAvatarHtml(row.actorEntityHash, { name: label })}
				<div>
					<div class="notification-type">${escapeHtml(message)}</div>
					<span class="post-meta">${escapeHtml(appContext.formatTime(row.at))}</span>
				</div>
			</div>
			<a href="${escapeHtml(href)}" class="notification-view-link">${escapeHtml(appContext.geti18n('social.notifications.view'))}</a>
		</div>
	`
	return card
}

/**
 * 绑定通知列表无限滚动。
 * @param {object} appContext 应用上下文
 * @returns {void}
 */
export function bindNotificationsInfiniteScroll(appContext) {
	const container = document.getElementById('notificationsView')
	if (!container) {
		disconnectInfiniteScroll()
		return
	}
	const sentinel = ensureScrollSentinel(container, 'notificationsScrollSentinel')
	bindInfiniteScroll({
		sentinel,
		hasMore: () => !!appContext.state.notificationsCursor,
		onLoad: () => loadNotifications(appContext, true),
	})
}

/**
 * 加载并渲染通知列表。
 * @param {object} appContext 应用上下文
 * @param {boolean} [append=false] 追加下一页
 * @returns {Promise<void>}
 */
export async function loadNotifications(appContext, append = false) {
	if (notificationsLoading) return
	notificationsLoading = true
	try {
		await ensureNotificationsSeenAt(appContext)
		const cursorQuery = append && appContext.state.notificationsCursor
			? `&cursor=${encodeURIComponent(appContext.state.notificationsCursor)}`
			: ''
		const data = await appContext.socialApi(`/notifications?limit=40${cursorQuery}`)
		const container = document.getElementById('notificationsView')
		const toolbar = document.getElementById('notificationsToolbar')
		const seenAt = getNotificationsSeenAt(appContext)
		const rows = data.notifications || []
		appContext.state.notificationsCursor = data.nextCursor || null
		appContext.state.lastNotificationUnreadCount = Number(data.unreadCount) || 0

		if (!append) {
			container.querySelectorAll('.notification-card, .empty').forEach(node => node.remove())
			if (!rows.length) {
				if (toolbar) toolbar.classList.add('hidden')
				const empty = document.createElement('div')
				empty.className = 'empty'
				empty.textContent = appContext.geti18n('social.empty.notifications')
				container.appendChild(empty)
				await markNotificationsSeen(appContext)
				disconnectInfiniteScroll()
				return
			}
		}

		if (toolbar) toolbar.classList.toggle('hidden', !append && !rows.length)
		for (const row of rows)
			container.insertBefore(renderNotificationCard(appContext, row, seenAt), document.getElementById('notificationsScrollSentinel'))

		if (!append)
			await markNotificationsSeen(appContext, rows.reduce((max, row) => Math.max(max, row.at || 0), 0) || Date.now())

		bindNotificationsInfiniteScroll(appContext)
	}
	finally {
		notificationsLoading = false
	}
}
