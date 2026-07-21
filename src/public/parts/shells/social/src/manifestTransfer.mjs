import {
	registerManifestOwnerMatcher,
	registerTransferKeyDependencies,
	unregisterTransferKeyDependencies,
} from 'npm:@steve02081504/fount-p2p/files/transfer_key_registry'

import { loadVaultMasterKey } from './vault_crypto/vault.mjs'

const OWNER_ID = 'social'

/**
 * 注册 Social 提供的 vault-wrap transfer key 依赖。
 * @returns {void}
 */
export function registerSocialManifestTransfer() {
	registerManifestOwnerMatcher(OWNER_ID, manifest => manifest.transferKeyDescriptor?.type === 'vault-wrap')
	registerTransferKeyDependencies(OWNER_ID, {
		/**
		 * @param {string} replicaUsername replica
		 * @param {string} entityHash vault entity
		 * @returns {Promise<Buffer | string | null>} 密钥材料
		 */
		async getVaultMasterKey(replicaUsername, entityHash) {
			const state = await loadVaultMasterKey(replicaUsername, entityHash)
			return state.masterKey
		},
	})
}

/** @returns {void} */
export function unregisterSocialManifestTransfer() {
	unregisterTransferKeyDependencies(OWNER_ID)
}
