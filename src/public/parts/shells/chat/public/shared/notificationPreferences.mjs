import { getNotificationPreferences, putNotificationPreferences } from '../src/endpoints/prefs.mjs'

/**
 * @returns {Promise<Record<string, object>>} 整档通知偏好
 */
export function loadNotificationPreferences() {
	return getNotificationPreferences()
}

/**
 * @param {Record<string, object>} prefs 整档通知偏好
 * @returns {Promise<Record<string, object>>} 写入后的整档偏好
 */
export function saveNotificationPreferences(prefs) {
	return putNotificationPreferences(prefs)
}

/**
 * @param {object} prefs 群级偏好
 * @returns {boolean} 当前是否处于静音窗口
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
