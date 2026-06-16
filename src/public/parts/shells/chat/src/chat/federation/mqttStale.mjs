/**
 * 本机 MQTT 联邦「可能过期」标记（口令轮换后 catchup 失败时置位）。
 */
import { federationBootstrapKey } from './bootstrapStore.mjs'

/** @type {Map<string, { markedAt: number, failCount: number }>} */
const staleByKey = new Map()

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {void}
 */
export function markMqttCredentialsStale(username, groupId) {
	const staleKey = federationBootstrapKey(username, groupId)
	const previous = staleByKey.get(staleKey)
	staleByKey.set(staleKey, {
		markedAt: Date.now(),
		failCount: (previous?.failCount || 0) + 1,
	})
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {boolean} 是否已标记 stale
 */
export function isMqttCredentialsStale(username, groupId) {
	return staleByKey.has(federationBootstrapKey(username, groupId))
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {void}
 */
export function clearMqttCredentialsStale(username, groupId) {
	staleByKey.delete(federationBootstrapKey(username, groupId))
}
