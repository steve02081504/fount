/** @type {Map<string, (username: string, groupId: string, hash: string) => Promise<Uint8Array | null>>} */
const federationFetchersByOwner = new Map()

/** @type {Map<string, (username: string) => Promise<{ nodeHash: string }> | { nodeHash: string }>} */
const nodeHashProvidersByOwner = new Map()

/**
 * @param {string} ownerId 注册方
 * @param {(username: string, groupId: string, hash: string) => Promise<Uint8Array | null>} fetcher 联邦 chunk 拉取
 * @returns {void}
 */
export function registerFederationChunkFetcher(ownerId, fetcher) {
	federationFetchersByOwner.set(String(ownerId), fetcher)
}

/**
 * @param {string} ownerId 注册方
 * @param {(username: string) => Promise<{ nodeHash: string }> | { nodeHash: string }} provider nodeHash
 * @returns {void}
 */
export function registerNodeHashProvider(ownerId, provider) {
	nodeHashProvidersByOwner.set(String(ownerId), provider)
}

/**
 * @param {string} ownerId 注册方
 * @returns {void}
 */
export function unregisterChunkProviders(ownerId) {
	const key = String(ownerId)
	federationFetchersByOwner.delete(key)
	nodeHashProvidersByOwner.delete(key)
}

/** @returns {void} */
export function clearChunkProviderRegistry() {
	federationFetchersByOwner.clear()
	nodeHashProvidersByOwner.clear()
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} hash chunk 哈希
 * @returns {Promise<Uint8Array | null>} 密文块
 */
export async function fetchFederationChunk(username, groupId, hash) {
	for (const fetcher of federationFetchersByOwner.values()) 
		try {
			const u8 = await fetcher(username, groupId, hash)
			if (u8?.byteLength) return u8
		}
		catch { /* next */ }
	
	return null
}

/**
 * @param {string} username replica 登录名
 * @returns {Promise<{ nodeHash: string }>} 节点标识
 */
export async function resolveNodeHash(username) {
	for (const provider of nodeHashProvidersByOwner.values()) 
		try {
			return await provider(username)
		}
		catch { /* next */ }
	
	return { nodeHash: 'local' }
}
