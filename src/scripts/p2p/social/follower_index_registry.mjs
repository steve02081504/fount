/** @type {((username: string) => Promise<string[]>) | null} */
let scanFollowingForUser = null

/** @type {(() => Iterable<string>) | null} */
let listReplicaUsernames = null

/**
 * Social Load 时注册：从 operator 时间线物化读取 following。
 * @param {(username: string) => Promise<string[]>} provider 扫描函数
 * @returns {void}
 */
export function registerFollowingScanProvider(provider) {
	scanFollowingForUser = provider
}

/**
 * Social Load 时注册：枚举本实例 replica 登录名（避免 p2p 层依赖 server/auth）。
 * @param {() => Iterable<string>} provider 用户名枚举
 * @returns {void}
 */
export function registerReplicaUsernamesProvider(provider) {
	listReplicaUsernames = provider
}

/** @returns {void} */
export function unregisterFollowingScanProvider() {
	scanFollowingForUser = null
}

/** @returns {void} */
export function unregisterReplicaUsernamesProvider() {
	listReplicaUsernames = null
}

/**
 * @returns {(username: string) => Promise<string[]> | null} 已注册扫描器
 */
export function getFollowingScanProvider() {
	return scanFollowingForUser
}

/**
 * @returns {(() => Iterable<string>) | null} 已注册 replica 枚举
 */
export function getReplicaUsernamesProvider() {
	return listReplicaUsernames
}
