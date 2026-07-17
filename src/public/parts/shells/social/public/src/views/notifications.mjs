import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { bindInfiniteScroll, disconnectInfiniteScroll, ensureScrollSentinel } from '/scripts/infiniteScroll.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { formatSocialPostHref, formatSocialProfileHref } from '../../shared/runUri.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import { authorLabel, formatTime, renderAvatarHtml } from '../lib/display.mjs'
import { socialState } from '../state.mjs'

/** @type {number | null} */
let badgeUnreadCount = null

/** @type {boolean} */
let notificationsLoading = false

/**
 * 确保已读水位已自服务端加载。
 * @returns {Promise<number>} 已读水位
 */
export async function ensureNotificationsSeenAt() {
	if (Number.isFinite(socialState.notificationsSeenAt))
		return socialState.notificationsSeenAt
	const data = await socialApi('/notifications/seen').catch(() => ({ seenAt: 0 }))
	socialState.notificationsSeenAt = Number(data.seenAt) || 0
	return socialState.notificationsSeenAt
}

/**
 * 读取通知已读水位时间戳（内存缓存）。
 * @returns {number} 已读水位
 */
export function getNotificationsSeenAt() {
	return Number(socialState.notificationsSeenAt) || 0
}

/**
 * 标记通知已读并更新角标。
 * @param {number} [at=Date.now()] 时间戳
 * @returns {Promise<void>}
 */
export async function markNotificationsSeen(at = Date.now()) {
	await socialApi('/notifications/seen', {
		method: 'PUT',
		body: JSON.stringify({ at }),
	})
	socialState.notificationsSeenAt = at
	badgeUnreadCount = 0
	await updateNotificationBadge()
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
	if (type === 'care_post') return 's-ic-notif-like'
	if (type === 'poll_closed') return 's-ic-vote'
	if (type === 'post_note') return 's-ic-note'
	if (type === 'live_started') return 's-ic-live'
	return 's-ic-bell'
}

/**
 * @returns {string} types 查询参数
 */
function notificationsTypesQuery() {
	const filter = socialState.notificationsFilter
	if (!filter || filter === 'all') return ''
	return `&types=${encodeURIComponent(filter)}`
}

/**
 * @param {object} row 通知条目
 * @returns {string} 动作文案
 */
function notificationMessage(row) {
	const actorCount = Number(row.actorCount) || 1
	const primaryLabel = authorLabel(row.actorEntityHash)
	const actors = Array.isArray(row.actors) && row.actors.length
		? row.actors
		: [{ entityHash: row.actorEntityHash }]
	const secondaryLabel = actors.length > 1
		? authorLabel(actors[1].entityHash)
		: primaryLabel
	const type = row.type
	const singleKey = `social.notifications.${type}`
	if (actorCount <= 1)
		return geti18n(singleKey, { author: primaryLabel })
	if (actorCount === 2 && type !== 'follow') {
		const twoKey = `social.inbox.aggregated.${type}Two`
		return geti18n(twoKey, { author1: primaryLabel, author2: secondaryLabel })
	}
	const aggregateKey = `social.inbox.aggregated.${type}`
	return geti18n(aggregateKey, {
		author1: primaryLabel,
		author2: secondaryLabel,
		count: String(actorCount),
	})
}

/**
 * @param {object} row 通知条目
 * @returns {string} 头像 HTML
 */
function notificationAvatarsHtml(row) {
	const actors = Array.isArray(row.actors) && row.actors.length
		? row.actors.slice(0, 3)
		: [{ entityHash: row.actorEntityHash }]
	if (actors.length <= 1)
		return renderAvatarHtml(actors[0].entityHash, { name: authorLabel(actors[0].entityHash) })
	return `<div class="notification-avatars stacked">${actors.map(actor =>
		renderAvatarHtml(actor.entityHash, { name: authorLabel(actor.entityHash) }),
	).join('')}</div>`
}

/**
 * 更新导航栏通知未读角标。
 * @returns {Promise<void>}
 */
export async function updateNotificationBadge() {
	const unread = Number.isFinite(badgeUnreadCount)
		? badgeUnreadCount
		: Number((await socialApi('/notifications?limit=1').catch(() => ({ unreadCount: 0 }))).unreadCount) || 0
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
 * @returns {void}
 */
export function bumpNotificationBadge() {
	const current = badgeUnreadCount ?? socialState.lastNotificationUnreadCount ?? 0
	badgeUnreadCount = current + 1
	socialState.lastNotificationUnreadCount = badgeUnreadCount
	void updateNotificationBadge()
}

/**
 * 通知条目跳转链接。
 * @param {object} row 通知条目
 * @returns {string} profile 链接
 */
function notificationHref(row) {
	if (row.type === 'reply' || row.type === 'mention')
		return formatSocialPostHref(row.actorEntityHash, row.postId)
	if ((row.type === 'like' || row.type === 'repost' || row.type === 'post_note' || row.type === 'poll_closed' || row.type === 'care_post')
		&& row.targetPostId && (row.targetEntityHash || socialState.viewerEntityHash))
		return formatSocialPostHref(row.targetEntityHash || socialState.viewerEntityHash, row.targetPostId)
	if (row.type === 'live_started')
		return formatSocialProfileHref(row.actorEntityHash)
	return formatSocialProfileHref(row.actorEntityHash)
}

/**
 * 渲染单条通知卡片。
 * @param {object} row 通知条目
 * @param {number} seenAt 已读水位
 * @returns {HTMLElement} 卡片
 */
function renderNotificationCard(row, seenAt) {
	const card = document.createElement('article')
	card.className = `notification-card${row.at > seenAt ? ' unread' : ''}`
	if (row.aggregateKey) card.dataset.aggregateKey = row.aggregateKey
	card.dataset.actorCount = String(Number(row.actorCount) || 1)
	card.dataset.at = String(Number(row.at) || 0)
	const message = notificationMessage(row)
	const href = notificationHref(row)
	const snippet = row.snippet
		? `<p class="notification-snippet">${escapeHtml(row.snippet)}</p>`
		: ''
	card.innerHTML = `
		<span class="notification-icon s-ic ${notificationIconClass(row.type)}" aria-hidden="true"></span>
		<div class="notification-body">
			<div class="post-header-row">
				${notificationAvatarsHtml(row)}
				<div>
					<div class="notification-type">${escapeHtml(message)}</div>
					<span class="post-meta">${escapeHtml(formatTime(row.at))}</span>
				</div>
			</div>
			${snippet}
			<a href="${escapeHtml(href)}" class="notification-view-link">${escapeHtml(geti18n('social.notifications.view'))}</a>
		</div>
	`
	return card
}

/**
 * @returns {boolean} 通知视图是否可见
 */
function notificationsViewActive() {
	return !document.getElementById('notificationsView')?.classList.contains('hidden')
}

/**
 * @param {object} row 通知条目
 * @returns {boolean} 是否应被当前 Tab 过滤掉
 */
function notificationFilteredOut(row) {
	const filter = socialState.notificationsFilter
	return !!(filter && filter !== 'all' && row.type !== filter)
}

/**
 * 将 WS 推送通知合并进当前列表。
 * @param {object} notification 原始通知
 * @returns {boolean} 是否已处理（合并或插入）
 */
export function mergeIncomingNotification(notification) {
	if (!notificationsViewActive() || notificationFilteredOut(notification))
		return false
	const container = document.getElementById('notificationsView')
	if (!container) return false
	container.querySelector('.empty')?.remove()
	const toolbar = document.getElementById('notificationsToolbar')
	if (toolbar) toolbar.classList.remove('hidden')
	const seenAt = getNotificationsSeenAt()
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
		const fresh = renderNotificationCard(merged, seenAt)
		fresh.dataset.knownActors = [...knownActors].join(',')
		existing.replaceWith(fresh)
		container.prepend(fresh)
		return true
	}
	const card = renderNotificationCard({
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
 * @returns {void}
 */
export function syncNotificationFilterTabs() {
	const filter = socialState.notificationsFilter || 'all'
	for (const button of document.querySelectorAll('[data-notif-filter]')) {
		if (!(button instanceof HTMLButtonElement)) continue
		const active = button.dataset.notifFilter === filter
		button.classList.toggle('active', active)
		button.setAttribute('aria-selected', active ? 'true' : 'false')
		button.setAttribute('role', 'tab')
	}
}

/**
 * 切换通知 Tab 并重新加载。
 * @param {string} filter 过滤类型
 * @returns {Promise<void>}
 */
export async function setNotificationFilter(filter) {
	socialState.notificationsFilter = filter
	socialState.notificationsCursor = null
	syncNotificationFilterTabs()
	await loadNotifications(false)
}

/**
 * 绑定通知列表无限滚动。
 * @returns {void}
 */
export function bindNotificationsInfiniteScroll() {
	const container = document.getElementById('notificationsView')
	if (!container) {
		disconnectInfiniteScroll()
		return
	}
	const sentinel = ensureScrollSentinel(container, 'notificationsScrollSentinel')
	bindInfiniteScroll({
		sentinel,
		/** @returns {boolean} 通知列表是否仍有下一页 */
		hasMore: () => !!socialState.notificationsCursor,
		/** @returns {Promise<void>} 追加加载下一页通知 */
		onLoad: () => loadNotifications(true),
	})
}

/**
 * 加载并渲染通知列表。
 * @param {boolean} [append=false] 追加下一页
 * @returns {Promise<void>}
 */
export async function loadNotifications(append = false) {
	if (notificationsLoading) return
	notificationsLoading = true
	let shouldBind = false
	try {
		await ensureNotificationsSeenAt()
		syncNotificationFilterTabs()
		const cursorQuery = append && socialState.notificationsCursor
			? `&cursor=${encodeURIComponent(socialState.notificationsCursor)}`
			: ''
		const data = await socialApi(`/notifications?limit=40${cursorQuery}${notificationsTypesQuery()}`)
		const container = document.getElementById('notificationsView')
		const toolbar = document.getElementById('notificationsToolbar')
		const seenAt = getNotificationsSeenAt()
		const rows = data.notifications || []
		socialState.notificationsCursor = data.nextCursor || null
		socialState.lastNotificationUnreadCount = Number(data.unreadCount) || 0

		if (!append) {
			container.querySelectorAll('.notification-card, .empty').forEach(node => node.remove())
			if (!rows.length) {
				if (toolbar) toolbar.classList.add('hidden')
				const empty = document.createElement('div')
				empty.className = 'empty'
				empty.textContent = geti18n('social.empty.notifications')
				container.appendChild(empty)
				await markNotificationsSeen()
				disconnectInfiniteScroll()
				return
			}
		}

		if (toolbar) toolbar.classList.toggle('hidden', !append && !rows.length)
		for (const row of rows) {
			const card = renderNotificationCard(row, seenAt)
			if (Array.isArray(row.actors))
				card.dataset.knownActors = row.actors.map(actor => actor.entityHash).join(',')
			container.insertBefore(card, document.getElementById('notificationsScrollSentinel'))
		}

		if (!append)
			await markNotificationsSeen(rows.reduce((max, row) => Math.max(max, row.at || 0), 0) || Date.now())

		// 必须在释放 notificationsLoading 后再 bind，否则 observe 后立刻触发的 onLoad 会被锁吞掉
		shouldBind = true
	}
	finally {
		notificationsLoading = false
	}
	if (shouldBind) bindNotificationsInfiniteScroll()
}
