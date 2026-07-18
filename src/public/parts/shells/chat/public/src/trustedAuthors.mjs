/**
 * 【文件】public/src/trustedAuthors.mjs
 * 【职责】IndexedDB 持久化「信任作者」公钥集合，决定 Markdown 是否走可信 pipeline。
 * 【原理】fount_chat_security/trustedAuthors store；syncTrustedAuthorsFromShell 与 shellData 同步；isTrustedAuthor 内存 Set 缓存。
 * 【数据结构】TRUST_EXPIRES_NEVER、{ pubKeyHash, expiresAt } 记录。
 * 【关联】trustAuthorDialog.mjs、hub/social Markdown 两档渲染；观看者声明的主人亦走可信档。
 */
const TRUSTED_AUTHORS_DB_NAME = 'fount_chat_security'
const TRUSTED_AUTHORS_STORE = 'trustedAuthors'

/** 永久信任：expiresAt 为 Infinity */
export const TRUST_EXPIRES_NEVER = Infinity

/** @type {Set<string> | null} */
let shellTrustedPubKeyHashes = null

/**
 * @param {number} expiresAt 过期时间戳或 TRUST_EXPIRES_NEVER
 * @returns {boolean} 是否仍在有效期内
 */
function isTrustStillActive(expiresAt) {
	return expiresAt === TRUST_EXPIRES_NEVER || Date.now() < expiresAt
}

/**
 * @param {string} pubKeyHash 作者公钥哈希
 * @returns {string} 规范化小写 hex
 */
function normalizePubKeyHash(pubKeyHash) {
	return String(pubKeyHash || '').toLowerCase()
}

/**
 * 从 shellData 拉取可信作者列表并合并进 IndexedDB（§17：同源本地 / shellData）。
 * @returns {Promise<void>}
 */
export async function syncTrustedAuthorsFromShell() {
	try {
		const response = await fetch('/api/parts/shells:chat/trusted-authors', { credentials: 'include' })
		if (!response.ok) return
		const data = await response.json()
		const hashes = Array.isArray(data.hashes) ? data.hashes : []
		shellTrustedPubKeyHashes = new Set(hashes.map(normalizePubKeyHash).filter(Boolean))
		const database = await openTrustedAuthorsDatabase()
		const existingRows = await new Promise((resolve, reject) => {
			const transaction = database.transaction(TRUSTED_AUTHORS_STORE, 'readonly')
			const request = transaction.objectStore(TRUSTED_AUTHORS_STORE).getAll()
			/** @returns {void} */
			request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : [])
			/** @returns {void} */
			request.onerror = () => reject(request.error)
		})
		const existingByPubKeyHash = new Map(
			existingRows.map(row => [normalizePubKeyHash(row.pubKeyHash), row]),
		)
		await new Promise((resolve, reject) => {
			const transaction = database.transaction(TRUSTED_AUTHORS_STORE, 'readwrite')
			const store = transaction.objectStore(TRUSTED_AUTHORS_STORE)
			for (const pubKeyHash of shellTrustedPubKeyHashes) {
				const existing = existingByPubKeyHash.get(pubKeyHash)
				if (existing && existing.expiresAt !== TRUST_EXPIRES_NEVER && Number.isFinite(existing.expiresAt))
					continue
				store.put({
					pubKeyHash,
					trustedAt: existing?.trustedAt ?? Date.now(),
					expiresAt: TRUST_EXPIRES_NEVER,
				})
			}
			/** @returns {void} */
			transaction.oncomplete = () => resolve()
			/** @returns {void} */
			transaction.onerror = () => reject(transaction.error)
		})
	}
	catch { /* 离线或未登录 */ }
}

/**
 * 将当前 IndexedDB 可信作者同步回 shellData。
 * @returns {Promise<void>}
 */
async function pushTrustedAuthorsToShell() {
	const database = await openTrustedAuthorsDatabase()
	const activePubKeyHashes = await new Promise((resolve, reject) => {
		const transaction = database.transaction(TRUSTED_AUTHORS_STORE, 'readonly')
		const request = transaction.objectStore(TRUSTED_AUTHORS_STORE).getAll()
		/** @returns {void} */
		request.onsuccess = () => {
			const rows = Array.isArray(request.result) ? request.result : []
			const hashes = rows
				.filter(row => row?.pubKeyHash && isTrustStillActive(row.expiresAt))
				.map(row => normalizePubKeyHash(row.pubKeyHash))
			resolve(hashes)
		}
		/** @returns {void} */
		request.onerror = () => reject(request.error)
	})
	await fetch('/api/parts/shells:chat/trusted-authors', {
		method: 'PUT',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ hashes: activePubKeyHashes }),
	})
	shellTrustedPubKeyHashes = new Set(activePubKeyHashes)
}

/**
 * 打开或创建 IndexedDB 数据库（可信作者公钥哈希存储）。
 * @returns {Promise<IDBDatabase>} 就绪的数据库连接
 */
function openTrustedAuthorsDatabase() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(TRUSTED_AUTHORS_DB_NAME, 1)
		/** @returns {void} */
		request.onerror = () => reject(request.error)
		/** @returns {void} */
		request.onupgradeneeded = () => {
			const database = request.result
			if (!database.objectStoreNames.contains(TRUSTED_AUTHORS_STORE))
				database.createObjectStore(TRUSTED_AUTHORS_STORE, { keyPath: 'pubKeyHash' })
		}
		/** @returns {void} */
		request.onsuccess = () => resolve(request.result)
	})
}

/**
 * 查询公钥哈希是否已被用户标记为可信作者。
 * @param {string} pubKeyHash 作者公钥的哈希（十六进制或存储键）
 * @returns {Promise<boolean>} 若已信任则为 true
 */
export async function isTrustedAuthor(pubKeyHash) {
	const normalized = normalizePubKeyHash(pubKeyHash)
	if (!normalized) return false
	const database = await openTrustedAuthorsDatabase()
	return new Promise((resolve, reject) => {
		const transaction = database.transaction(TRUSTED_AUTHORS_STORE, 'readwrite')
		const store = transaction.objectStore(TRUSTED_AUTHORS_STORE)
		const query = store.get(normalized)
		/** @returns {void} */
		query.onsuccess = () => {
			const record = query.result
			if (!record) {
				resolve(false)
				return
			}
			if (isTrustStillActive(record.expiresAt)) {
				resolve(true)
				return
			}
			store.delete(normalized)
			resolve(false)
		}
		/** @returns {void} */
		query.onerror = () => reject(query.error)
	})
}

/**
 * 是否为本人或本人的 agent（本机节点实体 / owner 声明指向本人）。
 * @param {string} entityHash 作者 entityHash
 * @param {{ selfEntityHash?: string | null, nodeHash?: string | null, authorOwnerEntityHash?: string | null }} [options] 信任上下文
 * @returns {boolean} 是否本人或本人 agent
 */
export function isSelfOrOwnedAgentEntity(entityHash, {
	selfEntityHash,
	nodeHash,
	authorOwnerEntityHash,
} = {}) {
	const eh = normalizePubKeyHash(entityHash)
	if (!eh) return false
	const self = normalizePubKeyHash(selfEntityHash)
	if (self && eh === self) return true
	if (self && normalizePubKeyHash(authorOwnerEntityHash) === self) return true
	const nh = normalizePubKeyHash(nodeHash)
	if (nh && eh.length >= 64 && eh.slice(0, 64) === nh) return true
	return false
}

/**
 * 作者是否为观看者声明的主人（其帖/消息走不安全渲染）。
 * @param {string} pubKeyHash 作者 pubKeyHash / entityHash
 * @param {{ viewerOwnerEntityHash?: string | null, authorEntityHash?: string | null }} [options] 观看者主人与作者实体
 * @returns {boolean} 是否主人
 */
export function isViewerDeclaredOwner(pubKeyHash, {
	viewerOwnerEntityHash,
	authorEntityHash,
} = {}) {
	const owner = normalizePubKeyHash(viewerOwnerEntityHash)
	if (!owner) return false
	const author = normalizePubKeyHash(authorEntityHash || pubKeyHash)
	return !!author && owner === author
}

/**
 * Markdown 是否走可信 pipeline：本人 / 本人 agent / 自己的主人 / 信任表。
 * @param {string} pubKeyHash 作者 entityHash / pubKeyHash
 * @param {{
 *   selfEntityHash?: string | null,
 *   nodeHash?: string | null,
 *   authorOwnerEntityHash?: string | null,
 *   viewerOwnerEntityHash?: string | null,
 *   authorEntityHash?: string | null,
 * }} [options] 信任上下文
 * @returns {Promise<boolean>} 是否可信
 */
export async function isTrustedMarkdownAuthor(pubKeyHash, options = {}) {
	if (isSelfOrOwnedAgentEntity(pubKeyHash, options)) return true
	if (isViewerDeclaredOwner(pubKeyHash, options)) return true
	return isTrustedAuthor(pubKeyHash)
}

/**
 * 将公钥哈希写入可信作者表。
 * @param {string} pubKeyHash 作者公钥哈希
 * @param {number} expiresAt 过期时间戳（ms）或 TRUST_EXPIRES_NEVER
 * @returns {Promise<void>} 写入完成
 */
export async function addTrustedAuthor(pubKeyHash, expiresAt = TRUST_EXPIRES_NEVER) {
	const normalized = normalizePubKeyHash(pubKeyHash)
	if (!normalized) return
	const database = await openTrustedAuthorsDatabase()
	await new Promise((resolve, reject) => {
		const transaction = database.transaction(TRUSTED_AUTHORS_STORE, 'readwrite')
		transaction.objectStore(TRUSTED_AUTHORS_STORE).put({
			pubKeyHash: normalized,
			trustedAt: Date.now(),
			expiresAt,
		})
		/** @returns {void} */
		transaction.oncomplete = () => resolve()
		/** @returns {void} */
		transaction.onerror = () => reject(transaction.error)
	})
	await pushTrustedAuthorsToShell().catch(() => { })
}
