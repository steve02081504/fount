import { getAllUserNames } from '../auth.mjs'

/**
 * @returns {string[]} 本机应接收 P2P 通知的 replica 登录名
 */
export function getNotifyReplicas() {
	return getAllUserNames()
}

/**
 * @param {string} [preferred] 首选 replica
 * @returns {string | null} 首选或第一个用户
 */
export function pickPrimaryReplica(preferred) {
	if (preferred && getAllUserNames().includes(preferred)) return preferred
	return getAllUserNames()[0] || null
}
