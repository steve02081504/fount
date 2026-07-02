/**
 * @typedef {object} EventTypeFlags
 * @property {boolean} [aclGated]
 * @property {boolean} [gcExclude]
 * @property {boolean} [governance]
 * @property {boolean} [permissionAnchor]
 */

/** @type {Map<string, Record<string, EventTypeFlags>>} */
const defsByOwner = new Map()

/**
 * @param {string} ownerId 注册方
 * @param {Record<string, EventTypeFlags>} defs 事件 type 元数据
 * @returns {void}
 */
export function registerEventTypeDefs(ownerId, defs) {
	defsByOwner.set(String(ownerId), defs)
}

/**
 * @param {string} ownerId 注册方
 * @returns {void}
 */
export function unregisterEventTypeDefs(ownerId) {
	defsByOwner.delete(String(ownerId))
}

/** @returns {void} */
export function clearEventTypeRegistry() {
	defsByOwner.clear()
}

/**
 * @returns {Record<string, EventTypeFlags>} 合并后的 defs
 */
export function mergedEventTypeDefs() {
	/** @type {Record<string, EventTypeFlags>} */
	const merged = {}
	for (const defs of defsByOwner.values())
		Object.assign(merged, defs)
	return merged
}

/**
 * @param {'aclGated' | 'gcExclude' | 'governance' | 'permissionAnchor'} flag 标志位名
 * @returns {Set<string>} 含该标志的事件 type 集合
 */
export function typesWithFlag(flag) {
	return new Set(Object.entries(mergedEventTypeDefs()).filter(([, f]) => f[flag]).map(([k]) => k))
}

/** §8 治理分叉选支：祖先闭包内计入信誉加权的类型。 */
/** @returns {Set<string>} 治理事件 type 集合 */
export function getGovernanceAuthzTypes() {
	return typesWithFlag('governance')
}

/** 联邦入站/中继前须物化 ACL 门控的类型。 */
/** @returns {Set<string>} ACL 门控事件 type 集合 */
export function getFederationAclGatedEventTypes() {
	return typesWithFlag('aclGated')
}

/** §6.2 频道 GC 沉寂计时排除的类型。 */
/** @returns {Set<string>} GC 排除事件 type 集合 */
export function getChannelGcExcludedEventTypes() {
	return typesWithFlag('gcExclude')
}

/** 裁剪时不得早于最早一条权限锚点事件（§7.1）。 */
/** @returns {Set<string>} 权限锚点事件 type 集合 */
export function getPermissionAnchorTypes() {
	return typesWithFlag('permissionAnchor')
}
