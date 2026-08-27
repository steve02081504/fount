import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../chat/src/entity/identity.mjs'

import { loadViewerContext } from './feed/home.mjs'
import { canViewByVisibility } from './lib/visibilitySpec.mjs'


/**
 * Social vault 文件 ACL（EVFS manifest 读权限）。
 * @param {string} replicaUsername 观看者 replica
 * @param {string} ownerEntityHash vault owner
 * @param {object} manifest manifest
 * @param {string} [viewerEntityHash] 观看实体；缺省为 operator
 * @returns {Promise<boolean>} 观看者是否可读该 vault 文件
 */
export async function canViewVaultFile(replicaUsername, ownerEntityHash, manifest, viewerEntityHash) {
	const visibility = manifest.meta?.visibility || 'followers'
	const viewer = viewerEntityHash
		? viewerEntityHash
		: await resolveOperatorEntityHash(replicaUsername)
	if (viewer === ownerEntityHash) return true
	const viewerContext = await loadViewerContext(replicaUsername, viewer)
	return canViewByVisibility(
		{ visibility, minFollowMs: manifest.meta?.minFollowMs, allow: manifest.meta?.allow, except: manifest.meta?.except },
		viewerContext,
		ownerEntityHash,
	)
}
