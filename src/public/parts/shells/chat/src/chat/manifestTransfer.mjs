import { Buffer } from 'node:buffer'

import {
	registerDagManifestPlaintextReader,
	registerManifestOwnerMatcher,
	registerTransferKeyDependencies,
	unregisterTransferKeyDependencies,
} from 'npm:@steve02081504/fount-p2p/files/transfer_key_registry'

import { getFileMasterKeyByGeneration, getCurrentFileMasterKey } from './file_keys/store.mjs'
import { getDecryptedFile } from './files/groupFiles.mjs'

const OWNER_ID = 'chat'

/**
 * 注册 Chat 提供的 transfer key 与 dag manifest 明文读取。
 * @returns {void}
 */
export function registerChatManifestTransfer() {
	registerManifestOwnerMatcher(OWNER_ID, manifest => Array.isArray(manifest.meta?.dagParts) && !!manifest.meta?.groupId)
	registerTransferKeyDependencies(OWNER_ID, {
		/**
		 * @param {string} replicaUsername replica
		 * @param {string} groupId 群 ID
		 * @param {number} [keyGeneration] 密钥代际
		 * @returns {Promise<Buffer | string | null>} 密钥材料
		 */
		async getGroupFileMasterKey(replicaUsername, groupId, keyGeneration) {
			if (keyGeneration != null && Number.isFinite(keyGeneration))
				return getFileMasterKeyByGeneration(replicaUsername, groupId, keyGeneration)
			const entry = await getCurrentFileMasterKey(replicaUsername, groupId)
			return entry?.fileMasterKey ?? null
		},
	})

	registerDagManifestPlaintextReader(OWNER_ID, async (replicaUsername, manifest) => {
		if (!Array.isArray(manifest.meta?.dagParts) || !manifest.meta?.groupId) return null
		const meta = {
			fileId: manifest.meta.fileId,
			size: manifest.size,
			mimeType: manifest.mimeType,
			contentHash: manifest.contentHash,
			ceMode: manifest.ceMode,
			key_generation: manifest.transferKeyDescriptor?.keyGeneration,
			parts: manifest.meta.dagParts,
		}
		try {
			const plain = await getDecryptedFile(replicaUsername, manifest.meta.groupId, meta)
			return Buffer.from(plain)
		}
		catch {
			return null
		}
	})
}

/** @returns {void} */
export function unregisterChatManifestTransfer() {
	unregisterTransferKeyDependencies(OWNER_ID)
}
