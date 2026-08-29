import {
	registerManifestAcl,
	unregisterManifestAcl,
} from 'npm:@steve02081504/fount-p2p/files/manifest/acl'
import {
	registerManifestServicer,
	unregisterManifestServicer,
} from 'npm:@steve02081504/fount-p2p/files/manifest/servicer_registry'
import { loadPeerPoolView } from 'npm:@steve02081504/fount-p2p/node/network'

import { canViewVaultFile } from './vaultAcl.mjs'

const OWNER_ID = 'social'

/**
 * 注册 Social Shell 提供的 vault-wrap manifest ACL 与跨节点 servicer。
 * @returns {void}
 */
export function registerSocialManifestAcl() {
	registerManifestAcl(OWNER_ID, async context =>
		canViewVaultFile(
			context.replicaUsername,
			context.ownerEntityHash,
			context.manifest,
			context.viewerEntityHash,
		),
	)
	// 跨节点 serve：请求方须为本节点已知 peer（vault 可见性为按实体模型，节点层仅做粗粒度门；
	// 真正的读授权靠 vault 主密钥解密）。
	registerManifestServicer(OWNER_ID, async ({ requesterNodeHash }) => {
		if (!requesterNodeHash) return false
		const view = loadPeerPoolView('')
		return [...view.trustedPeers || [], ...view.explorePeers || []].includes(requesterNodeHash)
	})
}

/** @returns {void} */
export function unregisterSocialManifestAcl() {
	unregisterManifestAcl(OWNER_ID)
	unregisterManifestServicer(OWNER_ID)
}
