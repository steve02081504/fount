import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../../../../server/p2p_server/operator_identity.mjs'

import { loadFollowing } from './following.mjs'


/**
 * Social vault 文件 ACL（EVFS manifest 读权限）。
 * @param {string} replicaUsername 观看者 replica
 * @param {string} ownerEntityHash vault owner
 * @param {import('../../../../../scripts/p2p/files/manifest.mjs').FileManifest} manifest manifest
 * @returns {Promise<boolean>} 观看者是否可读该 vault 文件
 */
export async function canViewVaultFile(replicaUsername, ownerEntityHash, manifest) {
	const visibility = manifest.meta?.visibility || 'followers'
	if (visibility === 'public') return true
	if (await resolveOperatorEntityHash(replicaUsername) === ownerEntityHash.toLowerCase()) return true
	if (visibility !== 'followers') return false
	const { following } = await loadFollowing(replicaUsername)
	return following.includes(ownerEntityHash.toLowerCase())
}
