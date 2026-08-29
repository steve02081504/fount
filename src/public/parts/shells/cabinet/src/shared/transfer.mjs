import {
	registerManifestAcl,
	unregisterManifestAcl,
} from 'npm:@steve02081504/fount-p2p/files/manifest/acl'
import {
	registerManifestOwner,
	unregisterManifestOwner,
} from 'npm:@steve02081504/fount-p2p/files/manifest/routing'
import {
	registerManifestServicer,
	unregisterManifestServicer,
} from 'npm:@steve02081504/fount-p2p/files/manifest/servicer_registry'
import {
	registerTransferKeyDependencies,
	unregisterTransferKeyDependencies,
} from 'npm:@steve02081504/fount-p2p/files/transfer_key_registry'
import { loadPeerPoolView } from 'npm:@steve02081504/fount-p2p/node/network'

import { loadSharedKeys, readKeyForGen } from './keys.mjs'

const OWNER_ID = 'cabinet'

/**
 * 注册共享柜 transfer key（file-master-key-wrap + groupId=cabinetId）、manifest ACL 与跨节点 servicer。
 * @returns {void}
 */
export function registerCabinetManifestTransfer() {
	registerManifestOwner(OWNER_ID, manifest => Boolean(manifest?.meta?.sharedCabinet || manifest?.meta?.cabinetId))
	registerTransferKeyDependencies(OWNER_ID, {
		/**
		 * @param {string} replicaUsername replica
		 * @param {string} cabinetId 柜 id（作 groupId）
		 * @param {number} [keyGeneration] 代际
		 * @returns {Promise<string | null>} 读密钥
		 */
		async getGroupFileMasterKey(replicaUsername, cabinetId, keyGeneration) {
			const keys = await loadSharedKeys(replicaUsername, cabinetId)
			if (!keys) return null
			return readKeyForGen(keys, keyGeneration)
		},
	})
	registerManifestAcl(OWNER_ID, async context => {
		const cabinetId = String(
			context.manifest?.transferKeyDescriptor?.groupId || context.manifest?.meta?.cabinetId || '',
		).trim()
		if (!cabinetId) return false
		const keys = await loadSharedKeys(context.replicaUsername, cabinetId)
		if (!keys) return false
		return !!readKeyForGen(keys, context.manifest?.transferKeyDescriptor?.keyGeneration)
	})
	// 跨节点 serve：请求方须为本节点已知 peer（真正的读授权靠共享柜读密钥解密）。
	registerManifestServicer(OWNER_ID, async ({ requesterNodeHash }) => {
		if (!requesterNodeHash) return false
		const view = loadPeerPoolView('')
		return [...view.trustedPeers || [], ...view.explorePeers || []].includes(requesterNodeHash)
	})
}

/** @returns {void} */
export function unregisterCabinetManifestTransfer() {
	unregisterManifestOwner(OWNER_ID)
	unregisterTransferKeyDependencies(OWNER_ID)
	unregisterManifestAcl(OWNER_ID)
	unregisterManifestServicer(OWNER_ID)
}
