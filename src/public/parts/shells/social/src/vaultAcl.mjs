import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../chat/src/entity/identity.mjs'

import { loadFollowingForActor } from './following.mjs'


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
	if (visibility === 'public') return true
	const owner = ownerEntityHash.toLowerCase()
	const viewer = viewerEntityHash
		? String(viewerEntityHash).trim().toLowerCase()
		: await resolveOperatorEntityHash(replicaUsername)
	if (viewer === owner) return true
	if (visibility !== 'followers') return false
	if (!viewer) return false
	const { following } = await loadFollowingForActor(replicaUsername, viewer)
	return following.includes(owner)
}
