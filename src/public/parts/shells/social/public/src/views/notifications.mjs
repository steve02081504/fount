import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { formatSocialProfileHref } from '../../shared/runUri.mjs'

import { bindInfiniteScroll, disconnectInfiniteScroll, ensureScrollSentinel } from '/scripts/infiniteScroll.mjs'

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
 * @param {object} appContext 应用上下文
 * @returns {string} types 查询参数
 */
function notificationsTypesQuery(appContext) {
	const filter = appContext.state.notificationsFilter
	if (!filter || filter === 'all') return ''
	return `&types=${encodeURIComponent(filter)}`
}

/**
 * @param {object} appContext 应用上下文
 * @param {object} row 通知条目
 * @returns {string} 动作文案
 */
function notificationMessage(appContext, row) {
	const actorCount = Number(row.actorCount) || 1
	const primaryLabel = appContext.authorLabel(row.actorEntityHash)
	const actors = Array.isArray(row.actors) && row.actors.length
		? row.actors
		: [{ entityHash: row.actorEntityHash }]
	const secondaryLabel = actors.length > 1
		? appContext.authorLabel(actors[1].entityHash)
		: primaryLabel
	const type = row.type
	const singleKey = `social.notifications.${type}`
	if (actorCount <= 1)
		return appContext.geti18n(singleKey, { author: primaryLabel })
	if (actorCount === 2 && type !== 'follow') {
		const twoKey = `social.inbox.aggregated.${type}Two`
		return appContext.geti18n(twoKey, { author1: primaryLabel, author2: secondaryLabel })
	}
	const aggregateKey = `social.inbox.aggregated.${type}`
	return appContext.geti18n(aggregateKey, {
		author1: primaryLabel,
		author2: secondaryLabel,
		count: String(actorCount),
	})
}

/**
 * @param {object} appContext 应用上下文
 * @param {object} row 通知条目
 * @returns {string} 头像 HTML
 */
function notificationAvatarsHtml(appContext, row) {
	const actors = Array.isArray(row.actors) && row.actors.length
		? row.actors.slice(0, 3)
		: [{ entityHash: row.actorEntityHash }]
	if (actors.length <= 1)
		return appContext.renderAvatarHtml(actors[0].entityHash, { name: appContext.authorLabel(actors[0].entityHash) })
	return `<div class="notification-avatars stacked">${actors.map(actor =>
		appContext.renderAvatarHtml(actor.entityHash, { name: appContext.authorLabel(actor.entityHash) }),
	).join('')}</div>`
}

/**
 * 更新导航栏通知未读角标。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function updateNotificationBadge(appContext) {
	const unread = Number.isFinite(badgeUnreadCount)
		? badgeUnreadCount
		: Number((await appContext.socialApi('/notifications?limit=1').catch(() => ({ unreadCount: 0 }))).unreadCount) || 0
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
	if (row.aggregateKey) card.dataset.aggregateKey = row.aggregateKey
	card.dataset.actorCount = String(Number(row.actorCount) || 1)
	card.dataset.at = String(Number(row.at) || 0)
	const message = notificationMessage(appContext, row)
	const href = notificationHref(appContext, row)
	const snippet = row.snippet
		? `<p class="notification-snippet">${escapeHtml(row.snippet)}</p>`
		: ''
	card.innerHTML = `
		<span class="notification-icon s-ic ${notificationIconClass(row.type)}" aria-hidden="true"></span>
		<div class="notification-body">
			<div class="post-header-row">
				${notificationAvatarsHtml(appContext, row)}
				<div>
					<div class="notification-type">${escapeHtml(message)}</div>
					<span class="post-meta">${escapeHtml(appContext.formatTime(row.at))}</span>
				</div>
			</div>
			${snippet}
			<a href="${escapeHtml(href)}" class="notification-view-link">${escapeHtml(appContext.geti18n('social.notifications.view'))}</a>
		</div>
	`
	return card
}

/**
 * @param {object} appContext 应用上下文
 * @returns {boolean} 通知视图是否可见
 */
function notificationsViewActive() {
	return !document.getElementById('notificationsView')?.classList.contains('hidden')
}

/**
 * @param {object} appContext 应用上下文
 * @param {object} row 通知条目
 * @returns {boolean} 是否应被当前 Tab 过滤掉
 */
function notificationFilteredOut(appContext, row) {
	const filter = appContext.state.notificationsFilter
	return !!(filter && filter !== 'all' && row.type !== filter)
}

/**
 * 将 WS 推送通知合并进当前列表。
 * @param {object} appContext 应用上下文
 * @param {object} notification 原始通知
 * @returns {boolean} 是否已处理（合并或插入）
 */
export function mergeIncomingNotification(appContext, notification) {
	if (!notificationsViewActive() || notificationFilteredOut(appContext, notification))
		return false
	const container = document.getElementById('notificationsView')
	if (!container) return false
	container.querySelector('.empty')?.remove()
	const toolbar = document.getElementById('notificationsToolbar')
	if (toolbar) toolbar.classList.remove('hidden')
	const seenAt = getNotificationsSeenAt(appContext)
	const aggregateKey = notification.aggregateKey
	const existing = aggregateKey
		? container.querySelector(`.notification-card[data-aggregate-key="${CSS.escape(aggregateKey)}"]`)
		: null
	if (existing instanceof HTMLElement) {
		const knownActors = new Set(
			(existing.dataset.knownActors || notification.actorEntityHash)
				.split(',').filter(Boolean),
		)
		const isNewActor = !knownActors.has(notification.actorEntityHash)
		if (isNewActor) knownActors.add(notification.actorEntityHash)
		const actorCount = Math.max(Number(existing.dataset.actorCount) || 1, knownActors.size)
		const at = Math.max(Number(existing.dataset.at) || 0, Number(notification.at) || 0)
		const merged = {
			...notification,
			actorCount,
			at,
			actors: [
				{ entityHash: notification.actorEntityHash, at: notification.at },
				...Array.isArray(notification.actors) ? notification.actors : [],
			].slice(0, 3),
			snippet: notification.snippet || existing.querySelector('.notification-snippet')?.textContent || null,
		}
		const fresh = renderNotificationCard(appContext, merged, seenAt)
		fresh.dataset.knownActors = [...knownActors].join(',')
		existing.replaceWith(fresh)
		container.prepend(fresh)
		return true
	}
	const card = renderNotificationCard(appContext, {
		...notification,
		actorCount: 1,
		actors: [{ entityHash: notification.actorEntityHash, at: notification.at }],
	}, seenAt)
	card.dataset.knownActors = notification.actorEntityHash
	const sentinel = document.getElementById('notificationsScrollSentinel')
	container.insertBefore(card, sentinel)
	return true
}

/**
 * 同步 Tab 激活态。
 * @param {object} appContext 应用上下文
 * @returns {void}
 */
export function syncNotificationFilterTabs(appContext) {
	const filter = appContext.state.notificationsFilter || 'all'
	for (const button of document.querySelectorAll('[data-notif-filter]')) {
		if (!(button instanceof HTMLButtonElement)) continue
		button.classList.toggle('active', button.dataset.notifFilter === filter)
	}
}

/**
 * 切换通知 Tab 并重新加载。
 * @param {object} appContext 应用上下文
 * @param {string} filter 过滤类型
 * @returns {Promise<void>}
 */
export async function setNotificationFilter(appContext, filter) {
	appContext.state.notificationsFilter = filter
	appContext.state.notificationsCursor = null
	syncNotificationFilterTabs(appContext)
	await loadNotifications(appContext, false)
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
		/** @returns {boolean} 通知列表是否仍有下一页 */
		hasMore: () => !!appContext.state.notificationsCursor,
		/** @returns {Promise<void>} 追加加载下一页通知 */
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
	let shouldBind = false
	try {
		await ensureNotificationsSeenAt(appContext)
		syncNotificationFilterTabs(appContext)
		const cursorQuery = append && appContext.state.notificationsCursor
			? `&cursor=${encodeURIComponent(appContext.state.notificationsCursor)}`
			: ''
		const data = await appContext.socialApi(`/notifications?limit=40${cursorQuery}${notificationsTypesQuery(appContext)}`)
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
		for (const row of rows) {
			const card = renderNotificationCard(appContext, row, seenAt)
			if (Array.isArray(row.actors))
				card.dataset.knownActors = row.actors.map(actor => actor.entityHash).join(',')
			container.insertBefore(card, document.getElementById('notificationsScrollSentinel'))
		}

		if (!append)
			await markNotificationsSeen(appContext, rows.reduce((max, row) => Math.max(max, row.at || 0), 0) || Date.now())

		// 必须在释放 notificationsLoading 后再 bind，否则 observe 后立刻触发的 onLoad 会被锁吞掉
		shouldBind = true
	}
	finally {
		notificationsLoading = false
	}
	if (shouldBind) bindNotificationsInfiniteScroll(appContext)
}
