/**
 * pack 内容 URL 解析与 IndexedDB 缓存。
 */
import { listEmojiProviders } from './providers.mjs'

const EMOJI_DB = 'fount_emoji_pack_cache'
const EMOJI_STORE = 'emojis'
const EMOJI_VER = 1

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null

/**
 * 打开（并复用）pack 表情 IndexedDB。
 * @returns {Promise<IDBDatabase>} 数据库连接
 */
function openEmojiDb() {
	if (dbPromise) return dbPromise
	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(EMOJI_DB, EMOJI_VER)
		/**
		 * @returns {void}
		 */
		request.onerror = () => {
			dbPromise = null
			reject(request.error)
		}
		/**
		 * @returns {void}
		 */
		request.onupgradeneeded = () => {
			const database = request.result
			if (!database.objectStoreNames.contains(EMOJI_STORE))
				database.createObjectStore(EMOJI_STORE, { keyPath: 'k' })
		}
		/**
		 * @returns {void}
		 */
		request.onsuccess = () => {
			const database = request.result
			/**
			 *
			 */
			database.onclose = () => { dbPromise = null }
			/**
			 *
			 */
			database.onversionchange = () => {
				database.close()
				dbPromise = null
			}
			resolve(database)
		}
	})
	return dbPromise
}

/**
 * IndexedDB 缓存键。
 * @param {string} packId 包 ID
 * @param {string} emojiId 表情 ID
 * @returns {string} `packId/emojiId`
 */
export function packEmojiCacheKey(packId, emojiId) {
	return `${packId}/${emojiId}`
}

/**
 * 读取缓存的表情 data URL / URL。
 * @param {string} packId 包 ID
 * @param {string} emojiId 表情 ID
 * @returns {Promise<string | null>} 缓存值；未命中为 null
 */
export async function getCachedPackEmoji(packId, emojiId) {
	try {
		const database = await openEmojiDb()
		const cacheKey = packEmojiCacheKey(packId, emojiId)
		return await new Promise((resolve, reject) => {
			const transaction = database.transaction(EMOJI_STORE, 'readonly')
			const query = transaction.objectStore(EMOJI_STORE).get(cacheKey)
			/**
			 * @returns {void}
			 */
			query.onsuccess = () => resolve(query.result?.v || null)
			/**
			 * @returns {void}
			 */
			query.onerror = () => reject(query.error)
		})
	}
	catch {
		return null
	}
}

/**
 * 写入表情缓存（best-effort；存储失败视为 miss）。
 * @param {string} packId 包 ID
 * @param {string} emojiId 表情 ID
 * @param {string} dataUrlOrUrl data URL 或远程 URL
 * @returns {Promise<void>}
 */
export async function putCachedPackEmoji(packId, emojiId, dataUrlOrUrl) {
	try {
		const database = await openEmojiDb()
		const cacheKey = packEmojiCacheKey(packId, emojiId)
		await new Promise((resolve, reject) => {
			const transaction = database.transaction(EMOJI_STORE, 'readwrite')
			transaction.objectStore(EMOJI_STORE).put({ k: cacheKey, v: dataUrlOrUrl })
			/**
			 * @returns {void}
			 */
			transaction.oncomplete = () => resolve()
			/**
			 * @returns {void}
			 */
			transaction.onerror = () => reject(transaction.error)
		})
	}
	catch { /* best-effort cache */ }
}

/**
 * 通过 provider 解析 pack 表情内容 URL。
 * @param {object} provider emoji provider（需 packContentUrl）
 * @param {string} packId 包 ID
 * @param {string} emojiId 表情 ID
 * @param {object} [item] 可选条目（social vault 等）
 * @returns {string | null} 内容 URL；provider 不支持为 null
 */
export function resolvePackContentUrl(provider, packId, emojiId, item) {
	if (typeof provider?.packContentUrl !== 'function') return null
	return provider.packContentUrl(packId, emojiId, item) || null
}

/**
 * 尽力解析可嵌入的 pack 表情 URL：IndexedDB → 各 provider.packContentUrl。
 * @param {string} packId 包 ID
 * @param {string} emojiId 表情 ID
 * @param {{ providers?: object[], item?: object }} [options] 可选已加载 providers / 条目
 * @returns {Promise<string | null>} data URL、API 路径或 null
 */
export async function resolvePackEmojiUrl(packId, emojiId, options = {}) {
	const cached = await getCachedPackEmoji(packId, emojiId)
	if (cached) return cached

	const providers = options.providers ?? await listEmojiProviders()
	for (const provider of providers) {
		const url = resolvePackContentUrl(provider, packId, emojiId, options.item)
		if (url) return url
	}
	return null
}
