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
			console.log('[SW DB] Database upgrade needed.') // 保留：数据库结构更改是重要事件
			const db = event.target.result
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, { keyPath: 'url' })
				store.createIndex('timestamp', 'timestamp', { unique: false })
				console.log('[SW DB] Object store and index created.') // 保留：首次创建或升级是重要事件
			}
		}

		request.onsuccess = event => {
			const db = event.target.result
			// 为数据库连接本身添加错误处理，防止后续操作因连接丢失而失败
			db.onerror = (event) => {
				console.error('[SW DB] Database error:', event.target.error)
				dbPromise = null // 连接出错，清除缓存的 Promise
			}
			resolve(db)
		}

		request.onerror = event => {
			console.error(`[SW DB] Database open error (Attempt ${attempt}):`, event.target.error) // 保留 Error
			dbPromise = null
			if (attempt < maxAttempts)
				// 使用 setTimeout 进行延迟重试
				setTimeout(() => {
					resolve(openMetadataDB(attempt + 1, maxAttempts))
				}, 1000 * attempt)
			else {
				console.error('[SW DB] Max DB open attempts reached.') // 保留 Error
				reject(event.target.error)
			}
		}

		request.onblocked = () => {
			// 阻塞通常发生在有其他标签页持有旧版本数据库连接未关闭时
			console.warn('[SW DB] Database open blocked. Please close other tabs using the database.') // 保留 Warn
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

		// 等待事务完成，确保数据写入
		await new Promise((resolve, reject) => {
			transaction.oncomplete = resolve
			transaction.onerror = () => {
				console.error(`[SW DB] Transaction error updating timestamp for ${url}:`, transaction.error) // 保留 Error
				reject(transaction.error)
			}
			transaction.onabort = () => {
				console.warn(`[SW DB] Transaction aborted updating timestamp for ${url}`) // 保留 Warn
				reject(new Error('Transaction aborted'))
			}
		})
	} catch (error) {
		console.error(`[SW DB] Failed to update timestamp for ${url}:`, error) // 保留 Error
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
		const transaction = db.transaction(STORE_NAME, 'readwrite')
		const store = transaction.objectStore(STORE_NAME)
		const index = store.index('timestamp')
		const range = IDBKeyRange.upperBound(expiryThreshold)

		// 遍历 IndexedDB 收集所有过期的 URL
		await new Promise((resolve, reject) => {
			const cursorRequest = index.openCursor(range)

			cursorRequest.onsuccess = event => {
				const cursor = event.target.result
				if (cursor) {
					if (cursor.value && cursor.value.url)
						urlsToDelete.push(cursor.value.url)
					else
						console.warn('[SW Cleanup] Found record without URL in cursor, skipping deletion:', cursor.value) // 保留 Warn

					cursor.continue()
				} else
					resolve() // 游标遍历完成

			}
			cursorRequest.onerror = event => {
				console.error('[SW Cleanup] Error iterating expired items:', event.target.error) // 保留 Error
				reject(event.target.error)
			}
		})

		if (urlsToDelete.length === 0) {
			await new Promise((resolve, reject) => { // 确保空操作事务也能正确关闭
				transaction.oncomplete = resolve
				transaction.onerror = reject
			})
			cleanupTimeout = undefined
			return
		}

		// 删除 Cache Storage 中的项目和 IndexedDB 中的元数据
		const cache = await caches.open(CACHE_NAME)
		let deletedFromCacheCount = 0
		let deletedMetadataCount = 0

		for (const url of urlsToDelete) {
			let cacheDeleted = false
			try {
				cacheDeleted = await cache.delete(url)
				if (!cacheDeleted)
					console.warn(`[SW Cleanup] Item not found in cache for ${url}, attempting metadata deletion anyway.`) // 保留 Warn


				await new Promise((resolve, reject) => {
					const deleteRequest = store.delete(url)
					deleteRequest.onsuccess = () => {
						if (cacheDeleted) deletedFromCacheCount++
						deletedMetadataCount++
						resolve()
					}
					deleteRequest.onerror = e => {
						console.error(`[SW Cleanup] Failed to delete metadata for ${url}:`, e.target.error) // 保留 Error
						reject(e.target.error)
					}
				})

			} catch (err) {
				console.error(`[SW Cleanup] Error during deletion process for ${url}:`, err) // 保留 Error
			}
		}

		// 等待整个事务完成
		await new Promise((resolve, reject) => {
			transaction.oncomplete = resolve
			transaction.onerror = (event) => {
				console.error('[SW Cleanup] Transaction failed during deletions:', event.target.error) // 保留 Error
				reject(event.target.error)
			}
			transaction.onabort = (event) => {
				console.warn('[SW Cleanup] Transaction aborted during deletions:', event.target.error) // 保留 Warn
				reject(new Error('Transaction aborted'))
			}
		})
	} catch (error) {
		console.error('[SW Cleanup] Cache cleanup process failed:', error) // 保留 Error
	} finally {
		cleanupTimeout = undefined
	}
}

// --- Service Worker Event Listeners ---

self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(CACHE_NAME).catch(error => {
			console.error(`[SW ${CACHE_NAME}] Failed to open cache during install:`, error) // 保留 Error
		})
	)
})

self.addEventListener('activate', event => {
	event.waitUntil(
		Promise.all([
			self.clients.claim(), // 确保 SW 立即控制现有页面
			cleanupExpiredCache() // 执行初始清理
		]).catch(error => {
			console.error(`[SW ${CACHE_NAME}] Activation failed:`, error) // 保留 Error
		})
	)
})

self.addEventListener('fetch', event => {
	if (event.request.method !== 'GET') return

	const requestUrl = new URL(event.request.url)
	const { protocol, pathname, href: url } = requestUrl

	if (!protocol.startsWith('http') || pathname.startsWith('/api/')) return

	event.respondWith(
		caches.open(CACHE_NAME).then(async cache => {
			const cachedResponse = await cache.match(event.request)
			const now = Date.now()

			const fetchPromise = fetch(event.request)
				.then(networkResponse => {
					if (networkResponse && networkResponse.ok && networkResponse.type !== 'opaque') {
						const responseToCache = networkResponse.clone()
						const finalUrl = networkResponse.url // 使用最终 URL，以处理重定向
						cache.put(finalUrl, responseToCache)
							.then(() => {
								updateTimestamp(finalUrl, now).then(() => {
									if (cleanupTimeout) clearTimeout(cleanupTimeout)
									cleanupTimeout = setTimeout(cleanupExpiredCache, 1000)
								})
							})
							.catch(err => {
								console.error(`[SW ${CACHE_NAME}] Failed to cache ${finalUrl}:`, err) // 保留 Error
							})
					} else if (networkResponse && networkResponse.type === 'opaque')
						// Opaque 响应无法检查状态或内容，通常不缓存
						console.log(`[SW ${CACHE_NAME}] Opaque response for: ${url}. Not caching.`) // 保留 Log: Opaque 响应是特殊情况
					else
						console.warn(`[SW ${CACHE_NAME}] Invalid network response for: ${url}. Status: ${networkResponse?.status}. Not caching.`) // 保留 Warn

					return networkResponse
				})
				.catch(error => {
					console.warn(`[SW ${CACHE_NAME}] Network fetch failed for: ${url}:`, error) // 保留 Warn
					throw error // 重新抛出，以便在无缓存时由外层处理
				})

			if (cachedResponse) {
				// 立即返回缓存（SWR 策略）
				updateTimestamp(cachedResponse.url || url, now) // 更新时间戳延长缓存寿命
				return cachedResponse
			}

			// 缓存未命中，等待网络响应
			return fetchPromise
		}).catch(error => {
			console.error(`[SW ${CACHE_NAME}] Fetch handler main error for ${url}:`, error) // 保留 Error
			throw error // 让浏览器处理最终错误
		})
	)
})
