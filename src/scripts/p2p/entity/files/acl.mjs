import { isLogicalEntityHash } from '../logical_entity.mjs'
import { isWritableLocalEntity } from '../replica.mjs'

import { checkManifestAcl, resolveManifestAclType } from './manifest_acl_registry.mjs'

/**
 * @param {string} replicaUsername 请求 replica
 * @param {string} ownerEntityHash 文件 owner
 * @param {import('../../files/manifest.mjs').FileManifest} manifest manifest
 * @returns {Promise<boolean>} 是否允许读
 */
export async function canReadManifest(replicaUsername, ownerEntityHash, manifest) {
	const type = resolveManifestAclType(manifest, ownerEntityHash)
	if (type)
		return checkManifestAcl(type, { replicaUsername, ownerEntityHash, manifest })

	if (isLogicalEntityHash(ownerEntityHash))
		return false

	return true
}

/**
 * @param {string} replicaUsername 请求 replica
 * @param {string} ownerEntityHash owner
 * @param {string} logicalPath 路径
 * @returns {Promise<boolean>} 是否允许写
 */
export async function canWriteManifestPath(replicaUsername, ownerEntityHash, logicalPath) {
	const type = resolveManifestAclType(null, ownerEntityHash)
	if (type)
		return checkManifestAcl(type, { replicaUsername, ownerEntityHash, manifest: /** @type {any} */ {} }, logicalPath)

	if (isLogicalEntityHash(ownerEntityHash))
		return false

	return isWritableLocalEntity(ownerEntityHash)
}
