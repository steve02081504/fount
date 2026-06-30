/**
 * 【文件】public/hub/core/urlHash.mjs
 * 【职责】Hub 地址栏 hash 与邀请码工具：`#group:…` / `#friends` 的解析、写入及入群邀请消费。
 */
import { PENDING_INVITE_STORAGE_KEY } from '../../src/pendingInviteStorage.mjs'

/** 好友列表模式的 hash 片段（`#friends`）。 */
export const FRIENDS_HASH = 'friends'

/**
 * 从 `location.hash` 解析当前群组与频道。
 * @returns {{ groupId: string | null, channelId: string | null }} 解析结果
 */
export function parseHash() {
	const hash = window.location.hash.substring(1)
	if (!hash.startsWith('group:')) return { groupId: null, channelId: null }
	const rest = hash.slice('group:'.length)
	const sep = rest.indexOf(':')
	if (sep < 0) return { groupId: null, channelId: null }
	try {
		const groupId = decodeURIComponent(rest.slice(0, sep))
		const channelId = rest.slice(sep + 1)
		if (!groupId || !channelId) return { groupId: null, channelId: null }
		return { groupId, channelId }
	}
	catch {
		return { groupId: null, channelId: null }
	}
}

/** @returns {boolean} 当前 hash 是否为好友列表模式 */
export function isFriendsHash() {
	return window.location.hash.slice(1) === FRIENDS_HASH
}

/**
 * 将当前群组/频道写入 hash（`#group:id:channel`）。
 * @param {string} groupId 群组 ID
 * @param {string | null} channelId 频道 ID
 * @returns {void} 无
 */
export function updateHash(groupId, channelId) {
	if (!groupId) return
	const newHash = `group:${encodeURIComponent(groupId)}:${channelId || 'default'}`
	if (window.location.hash.slice(1) === newHash) return
	const url = `${window.location.pathname}${window.location.search}#${newHash}`
	history.replaceState(null, '', url)
}

/** 将 hash 设为好友列表（`#friends`）。 @returns {void} */
export function updateFriendsHash() {
	if (window.location.hash.slice(1) === FRIENDS_HASH) return
	const url = `${window.location.pathname}${window.location.search}#${FRIENDS_HASH}`
	history.replaceState(null, '', url)
}

/**
 * 读取并消费 sessionStorage 中待用的入群邀请与联邦 bootstrap。
 * @param {string} groupId 群组 ID
 * @returns {{ inviteCode: string | null, fedBootstrap: { signalingAppId?: string, roomSecret?: string, introducerPubKeyHash?: string } | null }} 待消费邀请与 bootstrap
 */
export function consumePendingJoin(groupId) {
	const empty = { inviteCode: null, fedBootstrap: null }
	const raw = sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY)
	if (!raw) return empty
	let pending
	try { pending = JSON.parse(raw) }
	catch { return empty }
	if (pending?.groupId !== groupId) return empty
	sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY)
	const inviteCode = pending.inviteCode?.trim() || null
	const roomSecret = pending.roomSecret?.trim()
	const introducerPubKeyHash = pending.introducerPubKeyHash?.trim()
	const fedBootstrap = roomSecret || introducerPubKeyHash
		? {
			...roomSecret ? { roomSecret } : {},
			...pending.signalingAppId?.trim() ? { signalingAppId: pending.signalingAppId.trim() } : {},
			...introducerPubKeyHash ? { introducerPubKeyHash } : {},
		}
		: null
	return { inviteCode, fedBootstrap }
}

/**
 * 从 URL 查询参数读取 `invite` 邀请码。
 * @returns {string | null} 邀请码；无则 null
 */
export function inviteCodeFromUrl() {
	return new URLSearchParams(window.location.search).get('invite')?.trim() || null
}
