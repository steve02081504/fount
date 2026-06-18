/**
 * 群自定义表情 IndexedDB 缓存与 URL 解析。
 */
import { fetchGroupEmojiDataUrl } from './groupEmojiApi.mjs'

const EMOJI_DB = 'fount_chat_emoji_cache'
const EMOJI_STORE = 'emojis'
const EMOJI_VER = 1

/**
 * @returns {Promise<IDBDatabase>}
 */
function openEmojiDb() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(EMOJI_DB, EMOJI_VER)
		/**
		 *
		 */
		request.onerror = () => reject(request.error)
		/**
		 *
		 */
		request.onupgradeneeded = () => {
			const database = request.result
			if (!database.objectStoreNames.contains(EMOJI_STORE))
				database.createObjectStore(EMOJI_STORE, { keyPath: 'k' })
		}
		/**
		 *
		 */
		request.onsuccess = () => resolve(request.result)
	})
}

/**
 * @param {string} groupId
 * @param {string} emojiId
 * @returns {Promise<string | null>}
 */
export async function getCachedEmojiDataUrl(groupId, emojiId) {
	try {
		const database = await openEmojiDb()
		const cacheKey = `${groupId}/${emojiId}`
		return await new Promise((resolve, reject) => {
			const transaction = database.transaction(EMOJI_STORE, 'readonly')
			const query = transaction.objectStore(EMOJI_STORE).get(cacheKey)
			/**
			 *
			 */
			query.onsuccess = () => resolve(query.result?.v || null)
			/**
			 *
			 */
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
 * @param {(groupId: string, emojiId: string) => Promise<string | null>} resolveEmojiUrl
 * @returns {void}
 */
export function setEmojiUrlResolver(resolveEmojiUrl) {
	emojiUrlResolver = resolveEmojiUrl
}

/**
 * @param {string} groupId
 * @param {string} emojiId
 * @returns {Promise<string | null>}
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
 * @param {string} groupId
 * @param {string} emojiId
 * @param {string} dataUrlOrUrl
 * @returns {Promise<void>}
 */
export async function putCachedEmojiDataUrl(groupId, emojiId, dataUrlOrUrl) {
	const database = await openEmojiDb()
	const cacheKey = `${groupId}/${emojiId}`
	await new Promise((resolve, reject) => {
		const transaction = database.transaction(EMOJI_STORE, 'readwrite')
		transaction.objectStore(EMOJI_STORE).put({ k: cacheKey, v: dataUrlOrUrl })
		/**
		 *
		 */
		transaction.oncomplete = () => resolve()
		/**
		 *
		 */
		transaction.onerror = () => reject(transaction.error)
	})
}
