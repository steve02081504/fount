/** @type {((username: string) => Promise<string[]>) | null} */
let scanFollowingForUser = null

/** @type {(() => Iterable<string>) | null} */
let listReplicaUsernames = null

/** @type {((username: string) => Promise<string | null>) | null} */
let resolveOperatorEntityHash = null

/**
 * Social Load 时注册：从 operator 时间线物化读取 following。
 * @param {(username: string) => Promise<string[]>} provider 扫描函数
 * @returns {void}
 */
export function registerFollowingScanProvider(provider) {
	scanFollowingForUser = provider
}

/**
 * Social Load 时注册：枚举本实例 replica 登录名。
 * @param {() => Iterable<string>} provider 用户名枚举
 * @returns {void}
 */
export function registerReplicaUsernamesProvider(provider) {
	listReplicaUsernames = provider
}

/**
 * Social Load 时注册：由 server 解析 operator entityHash。
 * @param {(username: string) => Promise<string | null>} provider 解析函数
 * @returns {void}
 */
export function registerOperatorEntityHashProvider(provider) {
	resolveOperatorEntityHash = provider
}

/** @returns {void} */
export function unregisterFollowingScanProvider() {
	scanFollowingForUser = null
}

/** @returns {void} */
export function unregisterReplicaUsernamesProvider() {
	listReplicaUsernames = null
}

/** @returns {void} */
export function unregisterOperatorEntityHashProvider() {
	resolveOperatorEntityHash = null
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

/**
 * @returns {((username: string) => Promise<string | null>) | null} 已注册解析器
 */
export function getOperatorEntityHashProvider() {
	return resolveOperatorEntityHash
}
