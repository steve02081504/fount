/**
 * 群自定义表情 IndexedDB 缓存与 URL 解析。
 */
import { fetchGroupEmojiDataUrl } from './groupEmojiApi.mjs'

const EMOJI_DB = 'fount_chat_emoji_cache'
const EMOJI_STORE = 'emojis'
const EMOJI_VER = 1

/**
 * 打开表情缓存 IndexedDB。
 * @returns {Promise<IDBDatabase>} 数据库连接。
 */
function openEmojiDb() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(EMOJI_DB, EMOJI_VER)
		/** @returns {void} */
		request.onerror = () => reject(request.error)
		/** @returns {void} */
		request.onupgradeneeded = () => {
			const database = request.result
			if (!database.objectStoreNames.contains(EMOJI_STORE))
				database.createObjectStore(EMOJI_STORE, { keyPath: 'k' })
		}
		/** @returns {void} */
		request.onsuccess = () => resolve(request.result)
	})
}

/**
 * 读取已缓存的表情 data URL。
 * @param {string} groupId - 群 ID。
 * @param {string} emojiId - 表情 ID。
 * @returns {Promise<string | null>} data URL 或 null。
 */
export async function getCachedEmojiDataUrl(groupId, emojiId) {
	try {
		const database = await openEmojiDb()
		const cacheKey = `${groupId}/${emojiId}`
		return await new Promise((resolve, reject) => {
			const transaction = database.transaction(EMOJI_STORE, 'readonly')
			const query = transaction.objectStore(EMOJI_STORE).get(cacheKey)
			/** @returns {void} */
			query.onsuccess = () => resolve(query.result?.v || null)
			/** @returns {void} */
			query.onerror = () => reject(query.error)
		})
	}
	catch {
		return null
	}
}

/** @type {((groupId: string, emojiId: string) => Promise<string | null>) | null} */
let emojiUrlResolver = null

/**
 * 注册外部表情 URL 解析器（Hub 注入）。
 * @param {(groupId: string, emojiId: string) => Promise<string | null>} resolveEmojiUrl - 解析回调。
 * @returns {void}
 */
export function setEmojiUrlResolver(resolveEmojiUrl) {
	emojiUrlResolver = resolveEmojiUrl
}

/**
 * 尽力解析表情 URL（缓存 → 注入解析器 → API）。
 * @param {string} groupId - 群 ID。
 * @param {string} emojiId - 表情 ID。
 * @returns {Promise<string | null>} data URL 或 null。
 */
export async function resolveEmojiUrlBestEffort(groupId, emojiId) {
	const cached = await getCachedEmojiDataUrl(groupId, emojiId)
	if (cached) return cached
	if (emojiUrlResolver) {
		const fromResolver = await emojiUrlResolver(groupId, emojiId).catch(() => null)
		if (fromResolver) {
			await putCachedEmojiDataUrl(groupId, emojiId, fromResolver).catch(() => {})
			return fromResolver
		}
	}
	const fromApi = await fetchGroupEmojiDataUrl(groupId, emojiId).catch(() => null)
	if (fromApi) await putCachedEmojiDataUrl(groupId, emojiId, fromApi).catch(() => {})
	return fromApi
}

/**
 * 写入表情 data URL 缓存。
 * @param {string} groupId - 群 ID。
 * @param {string} emojiId - 表情 ID。
 * @param {string} dataUrlOrUrl - data URL 或可缓存 URL。
 * @returns {Promise<void>}
 */
export async function putCachedEmojiDataUrl(groupId, emojiId, dataUrlOrUrl) {
	const database = await openEmojiDb()
	const cacheKey = `${groupId}/${emojiId}`
	await new Promise((resolve, reject) => {
		const transaction = database.transaction(EMOJI_STORE, 'readwrite')
		transaction.objectStore(EMOJI_STORE).put({ k: cacheKey, v: dataUrlOrUrl })
		/** @returns {void} */
		transaction.oncomplete = () => resolve()
		/** @returns {void} */
		transaction.onerror = () => reject(transaction.error)
	})
}
