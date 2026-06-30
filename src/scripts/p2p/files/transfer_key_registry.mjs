/** @type {Map<string, { getGroupFileMasterKey?: (replicaUsername: string, groupId: string, keyGeneration?: number) => Promise<Buffer | string | null>, getVaultMasterKey?: (replicaUsername: string, entityHash: string) => Promise<Buffer | string | null> }>} */
const transferDepsByOwner = new Map()

/** @type {Map<string, (replicaUsername: string, manifest: import('./manifest.mjs').FileManifest) => Promise<Buffer | null>>} */
const dagPlaintextReadersByOwner = new Map()

/**
 * @param {string} ownerId 注册方
 * @param {{ getGroupFileMasterKey?: (replicaUsername: string, groupId: string, keyGeneration?: number) => Promise<Buffer | string | null>, getVaultMasterKey?: (replicaUsername: string, entityHash: string) => Promise<Buffer | string | null> }} deps 密钥源
 * @returns {void}
 */
export function registerTransferKeyDeps(ownerId, deps) {
	const key = String(ownerId)
	const prev = transferDepsByOwner.get(key) || {}
	transferDepsByOwner.set(key, { ...prev, ...deps })
}

/**
 * @param {string} ownerId 注册方
 * @param {(replicaUsername: string, manifest: import('./manifest.mjs').FileManifest) => Promise<Buffer | null>} reader dagParts 明文读取
 * @returns {void}
 */
export function registerDagManifestPlaintextReader(ownerId, reader) {
	dagPlaintextReadersByOwner.set(String(ownerId), reader)
}

/**
 * @param {string} ownerId 注册方
 * @returns {void}
 */
export function unregisterTransferKeyDeps(ownerId) {
	const key = String(ownerId)
	transferDepsByOwner.delete(key)
	dagPlaintextReadersByOwner.delete(key)
}

/** @returns {void} */
export function clearTransferKeyRegistry() {
	transferDepsByOwner.clear()
	dagPlaintextReadersByOwner.clear()
}

/**
 * 从 manifest 推断 transfer key 注册方 id。
 * @param {import('./manifest.mjs').FileManifest} manifest manifest
 * @returns {string | null} ownerId
 */
export function resolveManifestTransferOwnerId(manifest) {
	if (Array.isArray(manifest.meta?.dagParts) && manifest.meta?.groupId) return 'chat'
	if (manifest.transferKeyDescriptor?.type === 'vault-wrap') return 'social'
	return null
}

/**
 * @param {string} [ownerId] 显式注册方；省略时按 manifest 推断
 * @param {import('./manifest.mjs').FileManifest} [manifest] 用于推断 ownerId
 * @returns {{ getGroupFileMasterKey?: (replicaUsername: string, groupId: string, keyGeneration?: number) => Promise<Buffer | string | null>, getVaultMasterKey?: (replicaUsername: string, entityHash: string) => Promise<Buffer | string | null> }} 依赖
 */
export function resolveTransferKeyDeps(ownerId, manifest) {
	const resolved = ownerId || (manifest ? resolveManifestTransferOwnerId(manifest) : null)
	if (resolved) return transferDepsByOwner.get(String(resolved)) || {}
	return {}
}

/**
 * @param {string} replicaUsername replica
 * @param {import('./manifest.mjs').FileManifest} manifest manifest
 * @returns {Promise<Buffer | null>} 明文；无 reader 或未命中为 null
 */
export async function readDagManifestPlaintext(replicaUsername, manifest) {
	const ownerId = resolveManifestTransferOwnerId(manifest)
	if (ownerId) {
		const reader = dagPlaintextReadersByOwner.get(ownerId)
		if (reader)
			try {
				const buf = await reader(replicaUsername, manifest)
				if (buf?.length) return buf
			}
			catch { /* fall through */ }
		return null
	}

	return null
}
