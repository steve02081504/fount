import { CHAT_API_CLIENT_PREFIX } from './apiPaths.mjs'

const NOTIFY_PREFS_API = `${CHAT_API_CLIENT_PREFIX}/notify-prefs`

/**
 * @returns {Promise<Record<string, object>>} 整档通知偏好
 */
export async function loadNotifyPrefs() {
	const response = await fetch(NOTIFY_PREFS_API, { credentials: 'include' })
	const data = await response.json()
	if (!response.ok) throw new Error(data.error || 'load notify prefs failed')
	return data.prefs || {}
}

/**
 * @param {Record<string, object>} prefs 整档通知偏好
 * @returns {Promise<Record<string, object>>}
 */
export async function saveNotifyPrefs(prefs) {
	const response = await fetch(NOTIFY_PREFS_API, {
		method: 'PUT',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ prefs }),
	})
	const data = await response.json()
	if (!response.ok) throw new Error(data.error || 'save notify prefs failed')
	return data.prefs || {}
}

/**
 * @param {object} prefs 群级偏好
 * @returns {boolean}
 */
export function isNotifyMuted(prefs = {}) {
	if (prefs.mutedUntil === true) return true
	if (typeof prefs.mutedUntil === 'number' && prefs.mutedUntil > Date.now()) return true
	return false
}

/**
 * @param {Record<string, object>} allPrefs 整档偏好
 * @param {string} groupId 群 ID
 * @param {{ dmKind?: string }} [groupMeta] 群元数据
 * @returns {boolean} 侧栏是否显示 muted 样式
 */
export function isGroupMutedInSidebar(allPrefs, groupId, groupMeta = {}) {
	const groupPrefs = allPrefs[groupId] || {}
	const defaults = groupMeta.dmKind === 'ecdh' ? { mode: 'all' } : { mode: 'mentions' }
	const mode = groupPrefs.mode ?? defaults.mode
	return isNotifyMuted(groupPrefs) || mode === 'nothing'
}
