/**
 * 在线状态：心跳时效与对外展示的有效状态。
 */

/** 超过该毫秒未心跳则视为离线 */
export const HEARTBEAT_STALE_MS = 120_000

/**
 * @param {object} profile 用户资料（至少 status / lastSeenAt / entityHash）
 * @param {string} [viewerEntityHash] 查看者 entityHash
 * @param {{ isSelf?: boolean }} [options] isSelf 为 true 时隐身对本人可见
 * @returns {string} 有效状态
 */
export function computeEffectiveStatus(profile, viewerEntityHash, options = {}) {
	const stored = String(profile?.status || 'online')
	const isSelf = options.isSelf
		?? (viewerEntityHash && profile?.entityHash === viewerEntityHash)
	const lastSeen = profile?.lastSeenAt || 0
	const recentlySeen = lastSeen > 0 && Date.now() - lastSeen < HEARTBEAT_STALE_MS

	if (stored === 'invisible')
		return isSelf ? 'invisible' : 'offline'

	if (!recentlySeen)
		return 'offline'

	// 磁盘遗留的默认 offline：有心跳则对外为 online（手动状态不含 offline）
	if (stored === 'offline')
		return 'online'

	return stored
}
