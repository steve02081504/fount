/** @type {((username: string, entityHash: string) => string | null) | null} */
let resolveAgentCharPartName = null

/** @type {((username: string) => { entityHash: string, charPartName: string }[]) | null} */
let listLocalAgents = null

/**
 * Chat Load 时注册：解析本地 agent 的 chars 目录名。
 * @param {(username: string, entityHash: string) => string | null} resolver 解析函数
 * @returns {void}
 */
export function registerAgentCharResolver(resolver) {
	resolveAgentCharPartName = resolver
}

/**
 * Chat Load 时注册：枚举 replica 下本地 agent 实体。
 * @param {(username: string) => { entityHash: string, charPartName: string }[]} provider 枚举函数
 * @returns {void}
 */
export function registerListLocalAgentsProvider(provider) {
	listLocalAgents = provider
}

/** @returns {void} */
export function unregisterAgentCharResolver() {
	resolveAgentCharPartName = null
}

/** @returns {void} */
export function unregisterListLocalAgentsProvider() {
	listLocalAgents = null
}

/**
 * @returns {((username: string, entityHash: string) => string | null) | null} 已注册解析器
 */
export function getAgentCharResolver() {
	return resolveAgentCharPartName
}

/**
 * @returns {((username: string) => { entityHash: string, charPartName: string }[]) | null} 已注册枚举器
 */
export function getListLocalAgentsProvider() {
	return listLocalAgents
}
