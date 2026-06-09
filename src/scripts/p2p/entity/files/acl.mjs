import { isGroupEntityHash } from '../group_entity.mjs'
import { isWritableLocalEntity } from '../replica.mjs'

import { checkManifestAcl } from './manifest_acl_registry.mjs'

/**
 *
 */
export { findReplicaHostingEntityFiles, invalidateReplicaHostCache } from './replica_host_cache.mjs'

/**
 * @param {string} replicaUsername 请求 replica
 * @param {string} ownerEntityHash 文件 owner
 * @param {import('../../files/manifest.mjs').FileManifest} manifest manifest
 * @returns {Promise<boolean>} 是否允许读
 */
export async function canReadManifest(replicaUsername, ownerEntityHash, manifest) {
	const context = { replicaUsername, ownerEntityHash, manifest }
	if (manifest.transferKeyDescriptor?.type === 'vault-wrap')
		return checkManifestAcl('vault-wrap', context)

	if (isGroupEntityHash(ownerEntityHash))
		return checkManifestAcl('file-master-key-wrap', context)

	return true
}

/**
 * @param {string} replicaUsername 请求 replica
 * @param {string} ownerEntityHash owner
 * @param {string} logicalPath 路径
 * @returns {Promise<boolean>} 是否允许写
 */
export async function canWriteManifestPath(replicaUsername, ownerEntityHash, logicalPath) {
	if (isGroupEntityHash(ownerEntityHash))
		return checkManifestAcl('file-master-key-wrap', { replicaUsername, ownerEntityHash, manifest: /** @type {any} */ {} }, logicalPath)
	return isWritableLocalEntity(replicaUsername, ownerEntityHash)
}
