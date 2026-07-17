/**
 * Hub 跨群 inbox：API、badge 与 WS 增量。
 */
import { handleUIError } from '../src/ui/errors.mjs'

import { hubStore } from './core/state.mjs'

const INBOX_API = '/api/parts/shells:chat/inbox'

/** @type {number | null} */
let badgeUnreadCount = null

/**
 * @param {object} options 分页参数
 * @param {number} [options.limit] 条数
 * @param {string} [options.cursor] 游标
 * @returns {Promise<{ items: object[], nextCursor: string | null, unreadCount: number }>} 分页结果
 */
export async function fetchInboxPage(options = {}) {
	const params = new URLSearchParams()
	if (options.limit) params.set('limit', String(options.limit))
	if (options.cursor) params.set('cursor', String(options.cursor))
	if (options.kinds?.length) params.set('kinds', options.kinds.join(','))
	const query = params.toString()
	const response = await fetch(`${INBOX_API}${query ? `?${query}` : ''}`, { credentials: 'include' })
	if (!response.ok) throw new Error(`inbox ${response.status}`)
	return response.json()
}

/**
 * @param {number} [at] 已读水位毫秒
 * @returns {Promise<number>} 写入的 seenAt
 */
export async function markInboxSeen(at = Date.now()) {
	const response = await fetch(`${INBOX_API}/seen`, {
		method: 'PUT',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ at }),
	})
	if (!response.ok) throw new Error(`inbox seen ${response.status}`)
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
		handleUIError(error, 'chat.hub.inbox.badgeFetchFailed')
		return
	}
	badgeUnreadCount = null
	hubStore.inbox.unreadCount = unread
	const label = unread > 99 ? '99+' : String(unread)
	const badge = document.getElementById('hub-inbox-badge')
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
	const current = badgeUnreadCount ?? hubStore.inbox.unreadCount ?? 0
	badgeUnreadCount = current + 1
	void updateInboxBadge()
}

/**
 * WS `channel_message` 是否 @ 本机 viewer（依赖服务端 `mentions` 结构）。
 * @param {object} wireMessage 频道 WS 帧
 * @returns {boolean} 是否 @ 本机 viewer
 */
export function wireMessageMentionsViewer(wireMessage) {
	const viewerHash = String(hubStore.viewer.viewerEntityHash || hubStore.viewer.operatorEntityHash || '').toLowerCase()
	if (!viewerHash || !wireMessage) return false
	const hashes = wireMessage.mentions?.entityHashes
	if (!Array.isArray(hashes) || !hashes.map(hash => String(hash).toLowerCase()).includes(viewerHash)) return false
	const sender = String(wireMessage.message?.sender || '').toLowerCase()
	const viewerMember = String(hubStore.context.currentState?.viewerMemberPubKeyHash || '').toLowerCase()
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
