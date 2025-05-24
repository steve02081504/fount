const CACHE_NAME = 'fount'
const DB_NAME = 'service-worker-cache-metadata'
const STORE_NAME = 'timestamps'
const EXPIRY_DAYS = 13 // 缓存过期天数
const EXPIRY_MS = EXPIRY_DAYS * 24 * 60 * 60 * 1000 // 13 天对应的毫秒数

let dbPromise = null // 用于缓存 IndexedDB 连接
let cleanupTimeout // 清理任务的定时器

// --- IndexedDB Helper Functions ---

/**
 * 打开或创建 IndexedDB 数据库，支持重试机制。
 * @param {number} attempt 当前尝试次数
 * @param {number} maxAttempts 最大尝试次数
 * @returns {Promise<IDBDatabase>} IndexedDB 数据库实例的 Promise
 */
function openMetadataDB(attempt = 1, maxAttempts = 3) {
	if (dbPromise) return dbPromise

	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1) // 版本号为 1

		request.onupgradeneeded = event => {
			console.log('[SW DB] Database upgrade needed.')
			const db = event.target.result
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, { keyPath: 'url' })
				store.createIndex('timestamp', 'timestamp', { unique: false })
				console.log('[SW DB] Object store and index created.')
			}
		}

		request.onsuccess = event => {
			const db = event.target.result
			db.onerror = (event) => {
				console.error('[SW DB] Database error:', event.target.error)
				dbPromise = null
			}
			resolve(db)
		}

		request.onerror = event => {
			console.error(`[SW DB] Database open error (Attempt ${attempt}):`, event.target.error)
			dbPromise = null
			if (attempt < maxAttempts)
				setTimeout(() => {
					resolve(openMetadataDB(attempt + 1, maxAttempts))
				}, 1000 * attempt)
			else {
				console.error('[SW DB] Max DB open attempts reached.')
				reject(event.target.error)
			}
		}

		request.onblocked = () => {
			console.warn('[SW DB] Database open blocked. Please close other tabs using the database.')
		}
	})
	return dbPromise
}

/**
 * 更新或插入指定 URL 的时间戳。
 * @param {string} url 资源 URL
 * @param {number} timestamp 时间戳 (Date.now())
 * @returns {Promise<void>}
 */
async function updateTimestamp(url, timestamp) {
	try {
		const db = await openMetadataDB()
		const transaction = db.transaction(STORE_NAME, 'readwrite')
		const store = transaction.objectStore(STORE_NAME)
		store.put({ url, timestamp })

		await new Promise((resolve, reject) => {
			transaction.oncomplete = resolve
			transaction.onerror = () => {
				console.error(`[SW DB] Transaction error updating timestamp for ${url}:`, transaction.error)
				reject(transaction.error)
			}
			transaction.onabort = () => {
				console.warn(`[SW DB] Transaction aborted updating timestamp for ${url}`)
				reject(new Error('Transaction aborted'))
			}
		})
	} catch (error) {
		console.error(`[SW DB] Failed to update timestamp for ${url}:`, error)
	}
}

/**
 * 清理过期的缓存和对应的元数据。
 * @returns {Promise<void>}
 */
async function cleanupExpiredCache() {
	const now = Date.now()
	const expiryThreshold = now - EXPIRY_MS
	const urlsToDelete = []

	try {
		const db = await openMetadataDB()
		const transaction = db.transaction(STORE_NAME, 'readwrite') // Ensure readwrite for deletions
		const store = transaction.objectStore(STORE_NAME)
		const index = store.index('timestamp')
		const range = IDBKeyRange.upperBound(expiryThreshold)

		await new Promise((resolve, reject) => {
			const cursorRequest = index.openCursor(range)

			cursorRequest.onsuccess = event => {
				const cursor = event.target.result
				if (cursor) {
					if (cursor.value && cursor.value.url)
						urlsToDelete.push(cursor.value.url)
					else
						console.warn('[SW Cleanup] Found record without URL in cursor, skipping deletion:', cursor.value)

					cursor.continue()
				} else
					resolve()
			}
			cursorRequest.onerror = event => {
				console.error('[SW Cleanup] Error iterating expired items:', event.target.error)
				reject(event.target.error)
			}
		})

		if (urlsToDelete.length === 0) {
			// Ensure transaction closes even if no deletions
			await new Promise((resolve, reject) => {
				transaction.oncomplete = resolve
				transaction.onerror = (event) => {
					console.error('[SW Cleanup] Transaction error (no items to delete):', event.target.error)
					reject(event.target.error)
				}
				transaction.onabort = (event) => {
					console.warn('[SW Cleanup] Transaction aborted (no items to delete):', event.target.error)
					reject(new Error('Transaction aborted'))
				}
			}).catch(e => console.warn('[SW Cleanup] Error ensuring empty transaction completion:', e)) // Log and continue
			cleanupTimeout = undefined
			return
		}

		const cache = await caches.open(CACHE_NAME)
		let deletedFromCacheCount = 0
		let deletedMetadataCount = 0

		for (const url of urlsToDelete) {
			let cacheDeleted = false
			try {
				cacheDeleted = await cache.delete(url)
				if (!cacheDeleted)
					console.warn(`[SW Cleanup] Item not found in cache for ${url}, attempting metadata deletion anyway.`)


				await new Promise((resolve, reject) => {
					const deleteRequest = store.delete(url) // store is already part of the transaction
					deleteRequest.onsuccess = () => {
						if (cacheDeleted) deletedFromCacheCount++
						deletedMetadataCount++
						resolve()
					}
					deleteRequest.onerror = e => {
						console.error(`[SW Cleanup] Failed to delete metadata for ${url}:`, e.target.error)
						reject(e.target.error)
					}
				})
			} catch (err) {
				console.error(`[SW Cleanup] Error during deletion process for ${url}:`, err)
			}
		}

		// Wait for the entire transaction to complete
		await new Promise((resolve, reject) => {
			transaction.oncomplete = () => {
				console.log(`[SW Cleanup] Cleanup complete. Deleted ${deletedFromCacheCount} from cache, ${deletedMetadataCount} metadata entries for ${urlsToDelete.length} URLs.`)
				resolve()
			}
			transaction.onerror = (event) => {
				console.error('[SW Cleanup] Transaction failed during deletions:', event.target.error)
				reject(event.target.error)
			}
			transaction.onabort = (event) => {
				console.warn('[SW Cleanup] Transaction aborted during deletions:', event.target.error)
				reject(new Error('Transaction aborted'))
			}
		})
	} catch (error) {
		console.error('[SW Cleanup] Cache cleanup process failed:', error)
	} finally {
		cleanupTimeout = undefined
	}
}

// --- Service Worker Event Listeners ---

self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(CACHE_NAME).catch(error => {
			console.error(`[SW ${CACHE_NAME}] Failed to open cache during install:`, error)
		})
	)
})

self.addEventListener('activate', event => {
	event.waitUntil(
		Promise.all([
			self.clients.claim(),
			cleanupExpiredCache()
		]).catch(error => {
			console.error(`[SW ${CACHE_NAME}] Activation failed:`, error)
		})
	)
})

// --- MODIFIED FETCH HANDLER ---
self.addEventListener('fetch', event => {
	if (event.request.method !== 'GET') return

	const requestUrl = new URL(event.request.url)
	const { protocol, pathname, href: url } = requestUrl

	// Skip non-http/https requests and API calls (or any other paths you want to exclude)
	if (!protocol.startsWith('http') || pathname.startsWith('/api/'))
		return // Let the browser handle it, or network pass-through

	event.respondWith(
		(async () => {
			try {
				// 1. Try to fetch from the network first
				const networkResponse = await fetch(event.request)
				const now = Date.now()

				// 2. If network request is successful and cacheable,
				//    cache it and return the network response.
				if (networkResponse && networkResponse.ok && networkResponse.type !== 'opaque') {
					const cache = await caches.open(CACHE_NAME)
					const responseToCache = networkResponse.clone() // Clone for caching
					const finalUrl = networkResponse.url // Use final URL to handle redirects

					// Asynchronously cache and update metadata.
					// Don't await these, so the response to the page is not delayed.
					cache.put(finalUrl, responseToCache)
						.then(() => updateTimestamp(finalUrl, now))
						.then(() => {
							if (cleanupTimeout) clearTimeout(cleanupTimeout)
							cleanupTimeout = setTimeout(cleanupExpiredCache, 1000)
						})
						.catch(err => {
							console.error(`[SW ${CACHE_NAME}] Failed to cache ${finalUrl}:`, err)
						})
				}
				else if (networkResponse && networkResponse.type === 'opaque')
					// Opaque responses cannot be inspected, so we don't cache them by default.
					// Still, it's a "fetch result", so we return it.
					console.log(`[SW ${CACHE_NAME}] Opaque response for: ${url}. Not caching, returning network response.`)
				else if (networkResponse)
					// Network responded, but not with an 'ok' status (e.g., 404, 500).
					// This is still a "fetch result".
					console.warn(`[SW ${CACHE_NAME}] Network responded with status ${networkResponse.status} for: ${url}. Not caching, returning network response.`)

				// Return the network response (good, bad, or opaque)
				return networkResponse
			} catch (error) {
				// 3. If network fetch fails (e.g., offline), try to serve from cache.
				console.warn(`[SW ${CACHE_NAME}] Network fetch failed for: ${url}. Attempting to serve from cache. Error:`, error)

				const cache = await caches.open(CACHE_NAME)
				const cachedResponse = await cache.match(event.request)

				if (cachedResponse) {
					console.log(`[SW ${CACHE_NAME}] Serving from cache for: ${url}`)
					// Optional: If you want to update the timestamp even when serving from cache after network failure
					// await updateTimestamp(cachedResponse.url || url, Date.now());
					return cachedResponse
				}

				// 4. If not in cache either, re-throw the network error.
				// This will result in the browser's default network error page.
				console.warn(`[SW ${CACHE_NAME}] Cache miss for: ${url} after network failure. Propagating error.`)
				throw error
			}
		})()
	)
})
