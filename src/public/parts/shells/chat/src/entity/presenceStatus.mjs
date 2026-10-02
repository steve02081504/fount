/**
 * 在线状态：心跳时效与对外展示的有效状态。
 */

/** 超过该毫秒未心跳则视为离线 */
export const HEARTBEAT_STALE_MS = 120_000

/**
 * @param {object} profile 用户资料（至少 status / lastSeenAt / entityHash）
 * @param {string} [viewerEntityHash] 查看者 entityHash
 * @param {{ isSelf?: boolean, agentStatus?: string }} [options] 查看选项
 * @returns {string} 有效状态
 */
export function computeEffectiveStatus(profile, viewerEntityHash, options = {}) {
	const stored = String(options.agentStatus ?? (profile?.status || 'online'))
	const isSelf = options.isSelf
		?? (viewerEntityHash && profile?.entityHash === viewerEntityHash)
	// 已加载角色的运行时状态自带时效，不再叠加浏览器心跳判定（显式 offline 仍然生效）
	const isAgent = options.agentStatus != null

	if (stored === 'invisible')
		return isSelf ? 'invisible' : 'offline'

	if (isAgent)
		return stored

	const lastSeen = profile?.lastSeenAt || 0
	if (lastSeen <= 0 || Date.now() - lastSeen >= HEARTBEAT_STALE_MS)
		return 'offline'

	// 磁盘遗留的默认 offline：有心跳则对外为 online（手动状态不含 offline）
	return stored === 'offline' ? 'online' : stored
}
