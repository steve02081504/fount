/**
 * 群 replica 拆除闸：拆除开始后禁止再往该群目录写残渣；建群/重入时清除。
 */

/** @type {Set<string>} */
const purging = new Set()

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @returns {string} 键
 */
function key(username, groupId) {
	return `${username}\0${String(groupId).trim().toLowerCase()}`
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @returns {void}
 */
export function markGroupReplicaPurging(username, groupId) {
	purging.add(key(username, groupId))
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @returns {void}
 */
export function clearGroupReplicaPurging(username, groupId) {
	purging.delete(key(username, groupId))
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @returns {boolean} 拆除中/已拆除
 */
export function isGroupReplicaPurging(username, groupId) {
	return purging.has(key(username, groupId))
}
