const CACHE_NAME = 'fount'
const DB_NAME = 'service-worker-cache-metadata'
const STORE_NAME = 'timestamps'
const EXPIRY_DAYS = 13 // 缓存过期天数
const EXPIRY_MS = EXPIRY_DAYS * 24 * 60 * 60 * 1000 // 13 天对应的毫秒数
const BACKGROUND_FETCH_THROTTLE_MS = 24 * 60 * 60 * 1000 // 背景请求节流时间，例如每天一次

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
			// Handle potential database errors after opening
			db.onerror = (event) => {
				console.error('[SW DB] Database error:', event.target.error)
				dbPromise = null // Invalidate promise on error
			}
			db.onclose = () => {
				console.warn('[SW DB] Database connection closed unexpectedly.')
				dbPromise = null // Invalidate promise if closed
			}
			resolve(db)
		}

		request.onerror = event => {
			console.error(`[SW DB] Database open error (Attempt ${attempt}):`, event.target.error)
			dbPromise = null // Clear promise on error to allow retry
			if (attempt < maxAttempts)
				setTimeout(() => {
					// Recursively retry opening the DB
					resolve(openMetadataDB(attempt + 1, maxAttempts))
				}, 1000 * attempt) // Exponential backoff
			else {
				console.error('[SW DB] Max DB open attempts reached.')
				reject(event.target.error)
			}
		}

		request.onblocked = () => {
			// This happens if a previous connection is still open and blocking the upgrade/new connection
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
 * 获取指定 URL 的时间戳。
 * @param {string} url 资源 URL
 * @returns {Promise<number | null>} 时间戳或 null（如果不存在）
 */
async function getTimestamp(url) {
	try {
		const db = await openMetadataDB()
		const transaction = db.transaction(STORE_NAME, 'readonly')
		const store = transaction.objectStore(STORE_NAME)
		const request = store.get(url)

		return new Promise((resolve, reject) => {
			request.onsuccess = () => {
				resolve(request.result ? request.result.timestamp : null)
			}
			request.onerror = () => {
				console.error(`[SW DB] Error getting timestamp for ${url}:`, request.error)
				reject(request.error)
			}
		})
	} catch (error) {
		console.error(`[SW DB] Failed to get timestamp for ${url}:`, error)
		return null
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
		const transaction = db.transaction(STORE_NAME, 'readwrite') // 确保是读写模式以便删除
		const store = transaction.objectStore(STORE_NAME)
		const index = store.index('timestamp')
		const range = IDBKeyRange.upperBound(expiryThreshold) // 查找所有时间戳小于 expiryThreshold 的记录

		// 1. 获取所有过期 URL
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
				}
				else
					resolve() // 所有过期项已收集
			}
			cursorRequest.onerror = event => {
				console.error('[SW Cleanup] Error iterating expired items:', event.target.error)
				reject(event.target.error)
			}
		})

		if (urlsToDelete.length === 0) {
			console.log('[SW Cleanup] No expired items found.')
			// 即使没有需要删除的项，也要确保事务完成，否则会一直挂起
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

		// 2. 遍历 URLsToDelete，从 Cache 和 IndexedDB 中删除
		for (const url of urlsToDelete) {
			let cacheDeleted = false
			try {
				cacheDeleted = await cache.delete(url)
				if (!cacheDeleted)
					console.warn(`[SW Cleanup] Item not found in cache for ${url}, attempting metadata deletion anyway.`)

				// 在同一个事务中删除 IndexedDB 元数据
				await new Promise((resolve, reject) => {
					const deleteRequest = store.delete(url)
					deleteRequest.onsuccess = () => {
						if (cacheDeleted) deletedFromCacheCount++
						deletedMetadataCount++
						resolve()
					}
					deleteRequest.onerror = e => {
						console.error(`[SW Cleanup] Failed to delete metadata for ${url}:`, e.target.error)
						reject(e.target.error) // 即使一个失败，也记录，但继续尝试删除其他
					}
				})
			} catch (err) {
				console.error(`[SW Cleanup] Error during deletion process for ${url}:`, err)
			}
		}

		// 3. 等待整个事务完成
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
		console.error('[SW Cleanup] Cache cleanup process failed overall:', error)
	} finally {
		cleanupTimeout = undefined // 无论成功失败，清除定时器ID
	}
}

/**
 * 缓存优先策略：尝试从缓存获取，同时发起网络请求更新缓存。
 * 如果缓存存在，立即返回缓存。如果不存在，则等待网络响应。
 * 在 BACKGROUND_FETCH_THROTTLE_MS 时间内不反复发起背景网络请求。
 *
 * @param {Request} request 请求对象
 * @returns {Promise<Response>} 响应 Promise
 */
async function handleCacheFirst(request) {
	const { url } = request
	const cache = await caches.open(CACHE_NAME)
	const cachedResponse = await cache.match(request)
	const now = Date.now()

	// 标记是否需要发起背景网络请求
	let shouldFetchInBackground = true
	const storedTimestamp = await getTimestamp(url) // 获取该 URL 最后一次更新的时间戳

	if (storedTimestamp) {
		const timeSinceLastFetch = now - storedTimestamp
		if (timeSinceLastFetch < BACKGROUND_FETCH_THROTTLE_MS) {
			shouldFetchInBackground = false
			console.log(`[SW ${CACHE_NAME}] Throttling background fetch for ${url}. Last fetch was ${Math.round(timeSinceLastFetch / 1000)}s ago.`)
		}
	}

	// 初始化一个 Promise，如果不需要背景请求，它会立即解决为 null
	let backgroundUpdatePromise = Promise.resolve(null)

	if (shouldFetchInBackground)
		backgroundUpdatePromise = (async () => {
			try {
				const networkResponse = await fetch(request)
				const nowAfterFetch = Date.now() // 确保使用最新的时间戳

				if (networkResponse && networkResponse.ok && networkResponse.type !== 'opaque') {
					const responseToCache = networkResponse.clone()
					const finalUrl = networkResponse.url // 处理重定向后的最终URL

					await cache.put(finalUrl, responseToCache)
					await updateTimestamp(finalUrl, nowAfterFetch) // 更新为本次成功获取的时间
					console.log(`[SW ${CACHE_NAME}] Background cached and updated timestamp for ${finalUrl} (cache-first strategy).`)

					// 触发清理任务
					if (cleanupTimeout) clearTimeout(cleanupTimeout)
					cleanupTimeout = setTimeout(cleanupExpiredCache, 1000) // 延迟执行清理
					return networkResponse // 返回原始网络响应
				} else if (networkResponse && networkResponse.type === 'opaque')
					console.log(`[SW ${CACHE_NAME}] Opaque response for: ${url} (cache-first). Not caching in background.`)
				 else if (networkResponse)
					console.warn(`[SW ${CACHE_NAME}] Network responded with status ${networkResponse.status} for: ${url} (cache-first). Not caching in background.`)

				return networkResponse // 即使不缓存，也返回网络响应（如果有的话）
			} catch (error) {
				console.warn(`[SW ${CACHE_NAME}] Background network fetch failed for ${url} (cache-first strategy):`, error)
				return null // 表示网络请求失败
			}
		})()

	// 如果有缓存，立即返回缓存响应
	if (cachedResponse) {
		console.log(`[SW ${CACHE_NAME}] Serving ${url} from cache (cache-first strategy).`)
		// 无论是否触发了背景更新，都会立即返回缓存响应
		return cachedResponse
	}

	// 如果没有缓存，则等待背景的网络请求完成（或被节流的 promise 解决为 null）
	console.log(`[SW ${CACHE_NAME}] No cache for ${url}, waiting for network (cache-first strategy).`)
	const networkResponse = await backgroundUpdatePromise // 等待背景的 Promise

	if (networkResponse)
		return networkResponse

	// 如果缓存和网络都失败了（或者网络被节流但没有缓存）
	console.warn(`[SW ${CACHE_NAME}] Cache miss and network failed (or throttled without cache) for ${url} (cache-first strategy).`)
	// 抛出错误，以便浏览器显示默认错误页面
	throw new Error(`Failed to fetch ${url} from both cache and network.`)
}

/**
 * 网络优先策略：尝试从网络获取，网络失败则回退到缓存。
 * @param {Request} request 请求对象
 * @returns {Promise<Response>} 响应 Promise
 */
async function handleNetworkFirst(request) {
	const { url } = request
	try {
		// 1. 尝试从网络获取
		const networkResponse = await fetch(request)
		const now = Date.now()

		// 2. 如果网络请求成功且可缓存，则缓存并返回网络响应
		if (networkResponse && networkResponse.ok && networkResponse.type !== 'opaque') {
			const cache = await caches.open(CACHE_NAME)
			const responseToCache = networkResponse.clone() // 克隆响应以便缓存
			const finalUrl = networkResponse.url // 处理重定向后的最终URL

			// 异步缓存并更新元数据，不阻塞主线程返回响应
			cache.put(finalUrl, responseToCache)
				.then(() => updateTimestamp(finalUrl, now))
				.then(() => {
					// 只有成功缓存和更新时间戳后才考虑触发清理
					if (cleanupTimeout) clearTimeout(cleanupTimeout)
					cleanupTimeout = setTimeout(cleanupExpiredCache, 1000) // 延迟1秒执行清理
				})
				.catch(err => {
					console.error(`[SW ${CACHE_NAME}] Failed to cache ${finalUrl} (network-first):`, err)
				})
		}
		// Opaque 响应不能被检查，默认不缓存。直接返回网络响应。
		else if (networkResponse && networkResponse.type === 'opaque')
			console.log(`[SW ${CACHE_NAME}] Opaque response for: ${url} (network-first). Not caching, returning network response.`)

		// 网络响应非 OK (例如 404, 500)。不缓存，但返回网络响应。
		else if (networkResponse)
			console.warn(`[SW ${CACHE_NAME}] Network responded with status ${networkResponse.status} for: ${url} (network-first). Not caching, returning network response.`)


		// 返回网络响应（无论是成功、失败或不透明）
		return networkResponse
	} catch (error) {
		// 3. 如果网络请求失败（例如离线），尝试从缓存中提供
		console.warn(`[SW ${CACHE_NAME}] Network fetch failed for: ${url} (network-first). Attempting to serve from cache. Error:`, error)

		const cache = await caches.open(CACHE_NAME)
		const cachedResponse = await cache.match(request)

		if (cachedResponse) {
			console.log(`[SW ${CACHE_NAME}] Serving from cache for: ${url}`)
			// 可选：如果希望在从缓存提供服务时也更新时间戳，可在此处调用 updateTimestamp
			// await updateTimestamp(cachedResponse.url || url, Date.now());
			return cachedResponse
		}

		// 4. 如果缓存中也没有，则重新抛出网络错误，让浏览器处理
		console.warn(`[SW ${CACHE_NAME}] Cache miss for: ${url} after network failure (network-first). Propagating error.`)
		throw error
	}
}


// --- Service Worker Event Listeners ---

self.addEventListener('install', event => {
	console.log(`[SW ${CACHE_NAME}] Installing...`)
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then(cache => {
				console.log(`[SW ${CACHE_NAME}] Cache opened during install.`)
			})
			.catch(error => {
				console.error(`[SW ${CACHE_NAME}] Failed to open cache during install:`, error)
			})
	)
	self.skipWaiting() // 强制新的 Service Worker 立即激活
})

self.addEventListener('activate', event => {
	console.log(`[SW ${CACHE_NAME}] Activating...`)
	event.waitUntil(
		Promise.all([
			self.clients.claim(), // 立即控制所有客户端
			cleanupExpiredCache() // 激活时执行一次清理
		]).then(() => {
			console.log(`[SW ${CACHE_NAME}] Activation complete and initial cleanup performed.`)
		}).catch(error => {
			console.error(`[SW ${CACHE_NAME}] Activation failed:`, error)
		})
	)
})

self.addEventListener('fetch', event => {
	// 忽略非 GET 请求
	if (event.request.method !== 'GET') {
		console.debug(`[SW ${CACHE_NAME}] Skipping non-GET request: ${event.request.method} ${event.request.url}`)
		return // 交给浏览器处理
	}

	const requestUrl = new URL(event.request.url)
	const { protocol, pathname, href: url } = requestUrl

	// 忽略非 HTTP/HTTPS 请求
	if (!protocol.startsWith('http')) {
		console.debug(`[SW ${CACHE_NAME}] Skipping non-HTTP(S) request: ${url}`)
		return // 交给浏览器处理
	}

	// 忽略特定路径，例如 API 调用或 WebSocket 连接
	if (pathname.startsWith('/api/') || pathname.startsWith('/ws/')) {
		console.debug(`[SW ${CACHE_NAME}] Skipping API/WS request: ${url}`)
		return // 交给浏览器处理（通常这些不应该被缓存）
	}

	// 根据条件应用不同的策略
	if (!url.startsWith(self.location.origin) && !(
		/\bapi\b/i.test(url) &&
		!/\.(svg|html|mjs|js|css|jpg|png|gif|webp|bmp|mp3|mp4|ogg|wav|webm)$/i.test(url)
	)) {
		// 非本站且不是 API 调用，使用缓存优先策略
		console.log(`[SW ${CACHE_NAME}] Applying Cache-First strategy for: ${url}`)
		event.respondWith(handleCacheFirst(event.request))
	}
	else {
		// 其他情况，使用网络优先策略
		console.log(`[SW ${CACHE_NAME}] Applying Network-First strategy for: ${url}`)
		event.respondWith(handleNetworkFirst(event.request))
	}
})
