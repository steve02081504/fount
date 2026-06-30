import { registerManifestAcl, unregisterManifestAcl } from '../../../../../scripts/p2p/entity/files/manifest_acl_registry.mjs'

import { canViewVaultFile } from './vault_acl.mjs'

const OWNER_ID = 'social'

/**
 * 注册 Social Shell 提供的 vault-wrap manifest ACL。
 * @returns {void}
 */
export function registerSocialManifestAcl() {
	registerManifestAcl('vault-wrap', OWNER_ID, async context =>
		canViewVaultFile(context.replicaUsername, context.ownerEntityHash, context.manifest),
	)
}

/** @returns {void} */
export function unregisterSocialManifestAcl() {
	unregisterManifestAcl('vault-wrap', OWNER_ID)
}
