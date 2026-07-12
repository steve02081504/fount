/**
 * Manifest ACL 注册表：按 transferKeyDescriptor.type 路由，不硬编码业务概念。
 */

/** @type {Map<string, { ownerId: string, handler: (context: ManifestAclContext, logicalPath?: string) => Promise<boolean> }>} */
const handlersByType = new Map()

/** @type {Map<string, { ownerId: string, match: (manifest: import('../../files/manifest.mjs').FileManifest | null | undefined, ownerEntityHash: string) => string | null }>} */
const matchersByOwner = new Map()

/**
 * @typedef {{
 *   replicaUsername: string,
 *   ownerEntityHash: string,
 *   manifest: import('../../files/manifest.mjs').FileManifest,
 * }} ManifestAclContext
 */

/**
 * @param {string} type transferKeyDescriptor.type（如 vault-wrap、file-master-key-wrap）
 * @param {string} ownerId 注册方
 * @param {(context: ManifestAclContext, logicalPath?: string) => Promise<boolean>} handler ACL 检查
 * @returns {void}
 */
export function registerManifestAcl(type, ownerId, handler) {
	const key = String(type)
	const owner = String(ownerId)
	const existing = handlersByType.get(key)
	if (existing && existing.ownerId !== owner)
		throw new Error(`manifest acl handler for '${key}' already registered by '${existing.ownerId}'`)
	handlersByType.set(key, { ownerId: owner, handler })
}

/**
 * @param {string} type transferKeyDescriptor.type
 * @param {string} ownerId 注册方
 * @returns {void}
 */
export function unregisterManifestAcl(type, ownerId) {
	const key = String(type)
	const existing = handlersByType.get(key)
	if (!existing) return
	if (existing.ownerId === String(ownerId))
		handlersByType.delete(key)
}

/**
 * @param {string} ownerId 注册方
 * @param {(manifest: import('../../files/manifest.mjs').FileManifest | null | undefined, ownerEntityHash: string) => string | null} match ACL type 匹配
 * @returns {void}
 */
export function registerManifestAclMatcher(ownerId, match) {
	matchersByOwner.set(String(ownerId), { ownerId: String(ownerId), match })
}

/**
 * @param {string} ownerId 注册方
 * @returns {void}
 */
export function unregisterManifestAclMatcher(ownerId) {
	matchersByOwner.delete(String(ownerId))
}

/** @returns {void} */
export function clearManifestAclRegistry() {
	handlersByType.clear()
	matchersByOwner.clear()
}

/**
 * @param {import('../../files/manifest.mjs').FileManifest | null | undefined} manifest manifest
 * @param {string} ownerEntityHash owner
 * @returns {string | null} ACL type
 */
export function resolveManifestAclType(manifest, ownerEntityHash) {
	for (const { match } of matchersByOwner.values()) {
		const type = match(manifest, ownerEntityHash)
		if (type) return type
	}
	return null
}

/**
 * @param {string} type transferKeyDescriptor.type
 * @param {ManifestAclContext} context 上下文
 * @param {string} [logicalPath] 写路径（仅写 ACL 需要）
 * @returns {Promise<boolean>} 是否允许（未注册为 false）
 */
export async function checkManifestAcl(type, context, logicalPath) {
	const row = handlersByType.get(String(type))
	if (!row?.handler) return false
	return row.handler(context, logicalPath)
}
