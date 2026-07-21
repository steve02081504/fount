import {
	registerManifestAcl,
	registerManifestAclMatcher,
	unregisterManifestAcl,
	unregisterManifestAclMatcher,
} from 'npm:@steve02081504/fount-p2p/files/manifest_acl_registry'

import { canViewVaultFile } from './vaultAcl.mjs'

const OWNER_ID = 'social'

/**
 * 注册 Social Shell 提供的 vault-wrap manifest ACL。
 * @returns {void}
 */
export function registerSocialManifestAcl() {
	registerManifestAclMatcher(OWNER_ID, manifest =>
		manifest?.transferKeyDescriptor?.type === 'vault-wrap' ? 'vault-wrap' : null,
	)
	registerManifestAcl('vault-wrap', OWNER_ID, async context =>
		canViewVaultFile(
			context.replicaUsername,
			context.ownerEntityHash,
			context.manifest,
			context.viewerEntityHash,
		),
	)
}

/** @returns {void} */
export function unregisterSocialManifestAcl() {
	unregisterManifestAclMatcher(OWNER_ID)
	unregisterManifestAcl('vault-wrap', OWNER_ID)
}
