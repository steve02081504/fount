/**
 * Hub 跨群 @mention inbox：API、badge 与 WS 增量。
 */
import { hubStore } from './core/state.mjs'

const MENTIONS_API = '/api/parts/shells:chat/mentions'

/** @type {number | null} */
let badgeUnreadCount = null

/**
 * @param {object} options 分页参数
 * @param {number} [options.limit] 条数
 * @param {string} [options.cursor] 游标
 * @returns {Promise<{ mentions: object[], nextCursor: string | null, unreadCount: number }>} 分页结果
 */
export async function fetchMentionsPage(options = {}) {
	const params = new URLSearchParams()
	if (options.limit) params.set('limit', String(options.limit))
	if (options.cursor) params.set('cursor', String(options.cursor))
	const query = params.toString()
	const response = await fetch(`${MENTIONS_API}${query ? `?${query}` : ''}`, { credentials: 'include' })
	if (!response.ok) throw new Error(`mentions ${response.status}`)
	return response.json()
}

/**
 * @param {number} [at] 已读水位毫秒
 * @returns {Promise<number>} 写入的 seenAt
 */
export async function markMentionsSeen(at = Date.now()) {
	await fetch(`${MENTIONS_API}/seen`, {
		method: 'PUT',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ at }),
	})
	badgeUnreadCount = 0
	await updateMentionsBadge()
	return at
}

/**
 * @returns {Promise<void>}
 */
export async function updateMentionsBadge() {
	const unread = Number.isFinite(badgeUnreadCount)
		? badgeUnreadCount
		: Number((await fetchMentionsPage({ limit: 1 }).catch(() => ({ unreadCount: 0 }))).unreadCount) || 0
	badgeUnreadCount = null
	hubStore.mentions.unreadCount = unread
	const label = unread > 99 ? '99+' : String(unread)
	const badge = document.getElementById('hub-mentions-badge')
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
export function bumpMentionsBadge() {
	const current = badgeUnreadCount ?? hubStore.mentions.unreadCount ?? 0
	badgeUnreadCount = current + 1
	void updateMentionsBadge()
}

/**
 * WS `channel_message` 是否 @ 本机 viewer（依赖服务端 `mentionedEntityHashes`）。
 * @param {object} wireMessage 频道 WS 帧
 * @returns {boolean} 是否 @ 本机 viewer
 */
export function wireMessageMentionsViewer(wireMessage) {
	const viewerHash = String(hubStore.viewer.viewerEntityHash || hubStore.viewer.operatorEntityHash || '').toLowerCase()
	if (!viewerHash || !wireMessage) return false
	const hashes = wireMessage.mentionedEntityHashes
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
export function maybeBumpMentionsBadgeFromWire(wireMessage) {
	if (!wireMessageMentionsViewer(wireMessage)) return
	bumpMentionsBadge()
}
