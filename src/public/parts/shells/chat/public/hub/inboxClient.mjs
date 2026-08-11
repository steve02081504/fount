/**
 * Hub 跨群 inbox：badge 与 WS 增量（HTTP 在 endpoints/inbox）。
 */
import { fetchInboxPage, markInboxSeen as markInboxSeenApi } from '../src/endpoints/inbox.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'

import { store } from './core/state.mjs'
import { formatUnreadLabel } from './unread.mjs'

/** @type {number | null} */
let badgeUnreadCount = null

/**
 * @param {number} [at] 已读水位毫秒
 * @returns {Promise<number>} 写入的 seenAt
 */
export async function markInboxSeen(at = Date.now()) {
	await markInboxSeenApi(at)
	badgeUnreadCount = 0
	await updateInboxBadge()
	return at
}

/**
 * @returns {Promise<void>}
 */
export async function updateInboxBadge() {
	let unread = badgeUnreadCount
	if (!Number.isFinite(unread)) try {
		unread = Number((await fetchInboxPage({ limit: 1 })).unreadCount) || 0
	}
	catch (error) {
		handleError('chat.hub.inbox.badgeFetchFailed')(error)
		return
	}
	badgeUnreadCount = null
	store.inbox.unreadCount = unread
	const label = formatUnreadLabel(unread)
	const badge = document.getElementById('inbox-badge')
	if (!badge) return
	if (unread > 0) {
		badge.textContent = label
		badge.classList.remove('hidden')
	}
	else badge.classList.add('hidden')
}

/**
 * @returns {void}
 */
export function bumpInboxBadge() {
	const current = badgeUnreadCount ?? store.inbox.unreadCount ?? 0
	badgeUnreadCount = current + 1
	void updateInboxBadge()
}

/**
 * WS `channel_message` 是否 @ 本机 viewer（依赖服务端 `mentions` 结构）。
 * @param {object} wireMessage 频道 WS 帧
 * @returns {boolean} 是否 @ 本机 viewer
 */
export function wireMessageMentionsViewer(wireMessage) {
	const viewerHash = store.viewer.viewerEntityHash || store.viewer.operatorEntityHash || ''
	if (!viewerHash || !wireMessage) return false
	const hashes = wireMessage.mentions?.entityHashes
	if (!Array.isArray(hashes) || !hashes.includes(viewerHash)) return false
	const sender = wireMessage.message?.sender || ''
	const viewerMember = store.context.currentState?.viewerMemberPubKeyHash || ''
	return !(sender && viewerMember && sender === viewerMember)
}

/**
 * 频道 WS 新消息若 @ 本机 operator，递增 badge。
 * @param {object} wireMessage 频道 WS 帧
 * @returns {void}
 */
export function maybeBumpInboxBadgeFromWire(wireMessage) {
	if (!wireMessageMentionsViewer(wireMessage)) return
	bumpInboxBadge()
}
