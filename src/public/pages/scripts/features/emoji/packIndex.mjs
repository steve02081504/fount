/**
 * pack 内容 URL 解析与 IndexedDB 缓存（内容 + pack 元数据 label）。
 */
import { loadPreferredLangs, primaryLocale } from '../../i18n/index.mjs'

import { parseEmojiRef } from './emojiRef.mjs'
import { resolveEmojiItemLabels } from './packPresentation.mjs'
import { aggregateEmojiPacks, listEmojiProviders } from './providers.mjs'

const EMOJI_DB = 'fount_emoji_pack_cache'
const EMOJI_STORE = 'emojis'
const EMOJI_META_STORE = 'packs'
const EMOJI_VER = 2

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
			if (!database.objectStoreNames.contains(EMOJI_META_STORE))
				database.createObjectStore(EMOJI_META_STORE, { keyPath: 'k' })
		}
		/**
		 * @returns {void}
		 */
		request.onsuccess = () => {
			const database = request.result
			/** 连接关闭时清空复用中的数据库 Promise。 */
			database.onclose = () => { dbPromise = null }
			/** 其他标签页升级 schema 时关闭并作废本地连接。 */
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

/**
 * 读取缓存 pack 元数据（items 的 emojiId → label）。
 * @param {string} packId 包 ID
 * @returns {Promise<Array<{ id: string, name: string, alt: string }> | null>} 缓存条目；未命中为 null
 */
async function getCachedPackMeta(packId) {
	try {
		const database = await openEmojiDb()
		return await new Promise((resolve, reject) => {
			const transaction = database.transaction(EMOJI_META_STORE, 'readonly')
			const query = transaction.objectStore(EMOJI_META_STORE).get(packId)
			/**
			 * @returns {void}
			 */
			query.onsuccess = () => resolve(Array.isArray(query.result?.v) ? query.result.v : null)
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
 * 写入 pack 元数据缓存（best-effort；存储失败视为 miss）。
 * @param {string} packId 包 ID
 * @param {Array<{ id: string, name: string, alt: string }>} items label 条目
 * @returns {Promise<void>}
 */
async function putCachedPackMeta(packId, items) {
	try {
		const database = await openEmojiDb()
		await new Promise((resolve, reject) => {
			const transaction = database.transaction(EMOJI_META_STORE, 'readwrite')
			transaction.objectStore(EMOJI_META_STORE).put({ k: packId, v: items })
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
 * 将 provider 聚合出的 pack 条目写入 label 缓存（按当前语言解析 name/alt）。
 * @param {object[]} packs provider 聚合包列表
 * @returns {void}
 */
export function seedEmojiLabelIndex(packs) {
	const locales = loadPreferredLangs().length ? loadPreferredLangs() : [primaryLocale()]
	for (const pack of packs || []) {
		const packId = String(pack?.packId || '').trim()
		if (!packId) continue
		const items = (pack.items || pack.entries || [])
			.map(entry => {
				const { name, alt } = resolveEmojiItemLabels(entry, locales)
				return { id: String(entry?.emojiId || ''), name, alt }
			})
			.filter(item => item.id)
		if (items.length) void putCachedPackMeta(packId, items)
	}
}

/** @type {Promise<void> | null} */
let metaIndexPromise = null

/**
 * 惰性补齐 label 索引：触发一次 provider 聚合并写入缓存（去重，失败静默）。
 * @returns {Promise<void>} 补齐完成
 */
function ensurePackMetaIndex() {
	if (!metaIndexPromise)
		metaIndexPromise = aggregateEmojiPacks({})
			.then(({ packs }) => { seedEmojiLabelIndex(packs) })
			.catch(() => { })
			.finally(() => { metaIndexPromise = null })
	return metaIndexPromise
}

/**
 * 解析 emojiRef 的显示 label（alt/name）：IndexedDB → 一次 provider 补齐 → 回落 emojiId。
 * @param {string} emojiRef 表情引用（unicode 或 `:[emoji:packId/emojiId]:`）
 * @returns {Promise<string>} 显示 label
 */
export async function resolveEmojiRefLabel(emojiRef) {
	const parsed = parseEmojiRef(emojiRef)
	if (!parsed) return ''
	if (parsed.kind === 'unicode') return parsed.unicode
	/** 从缓存读取单条 label。
	 * @returns {Promise<string | undefined>} label
	 */
	const find = async () => (await getCachedPackMeta(parsed.packId))?.find(item => item.id === parsed.emojiId)?.alt
	const hit = await find()
	if (hit) return hit
	await ensurePackMetaIndex()
	return await find() || parsed.emojiId
}
