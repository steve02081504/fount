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
 * @returns {{ getGroupFileMasterKey?: (replicaUsername: string, groupId: string, keyGeneration?: number) => Promise<Buffer | string | null>, getVaultMasterKey?: (replicaUsername: string, entityHash: string) => Promise<Buffer | string | null> }} 聚合后的依赖
 */
export function resolveTransferKeyDeps() {
	/** @type {((replicaUsername: string, groupId: string, keyGeneration?: number) => Promise<Buffer | string | null>) | undefined} */
	let getGroupFileMasterKey
	/** @type {((replicaUsername: string, entityHash: string) => Promise<Buffer | string | null>) | undefined} */
	let getVaultMasterKey
	for (const deps of transferDepsByOwner.values()) {
		if (deps.getGroupFileMasterKey) getGroupFileMasterKey = deps.getGroupFileMasterKey
		if (deps.getVaultMasterKey) getVaultMasterKey = deps.getVaultMasterKey
	}
	return { getGroupFileMasterKey, getVaultMasterKey }
}

/**
 * @param {string} replicaUsername replica
 * @param {import('./manifest.mjs').FileManifest} manifest manifest
 * @returns {Promise<Buffer | null>} 明文；无 reader 或未命中为 null
 */
export async function readDagManifestPlaintext(replicaUsername, manifest) {
	for (const reader of dagPlaintextReadersByOwner.values())
		try {
			const buf = await reader(replicaUsername, manifest)
			if (buf?.length) return buf
		}
		catch { /* try next */ }

	return null
}
