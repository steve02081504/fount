import {
	registerManifestOwnerMatcher,
	registerTransferKeyDependencies,
	unregisterTransferKeyDependencies,
} from 'npm:@steve02081504/fount-p2p/files/transfer_key_registry'

import { loadSharedKeys, readKeyForGen } from './keys.mjs'

const OWNER_ID = 'cabinet'

/**
 * 注册共享柜 transfer key（file-master-key-wrap + groupId=cabinetId）。
 * @returns {void}
 */
export function registerCabinetManifestTransfer() {
	registerManifestOwnerMatcher(OWNER_ID, manifest => Boolean(manifest.meta?.sharedCabinet || manifest.meta?.cabinetId))
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
}

/** @returns {void} */
export function unregisterCabinetManifestTransfer() {
	unregisterTransferKeyDependencies(OWNER_ID)
}
