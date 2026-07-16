import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../chat/src/entity/identity.mjs'

import { loadViewerContext } from './feed/home.mjs'
import { canViewByVisibility } from './lib/visibilitySpec.mjs'


/**
 * Social vault 文件 ACL（EVFS manifest 读权限）。
 * @param {string} replicaUsername 观看者 replica
 * @param {string} ownerEntityHash vault owner
 * @param {import('npm:@steve02081504/fount-p2p/files/manifest').FileManifest} manifest manifest
 * @param {string} [viewerEntityHash] 观看实体；缺省为 operator
 * @returns {Promise<boolean>} 观看者是否可读该 vault 文件
 */
export async function canViewVaultFile(replicaUsername, ownerEntityHash, manifest, viewerEntityHash) {
	const visibility = manifest.meta?.visibility || 'followers'
	const owner = ownerEntityHash.toLowerCase()
	const viewer = viewerEntityHash
		? String(viewerEntityHash).trim().toLowerCase()
		: await resolveOperatorEntityHash(replicaUsername)
	if (viewer === owner) return true
	const viewerContext = await loadViewerContext(replicaUsername, viewer)
	return canViewByVisibility(
		{ visibility, minFollowMs: manifest.meta?.minFollowMs, allow: manifest.meta?.allow, except: manifest.meta?.except },
		viewerContext,
		owner,
	)
}
