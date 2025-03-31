// !! 增加版本号（例如 'v1', 'v2' 等）会触发 Service Worker 更新并清除旧版本缓存。
const CACHE_NAME = 'fount' // 示例：增加版本号
const DB_NAME = 'service-worker-cache-metadata'
const STORE_NAME = 'timestamps'
const EXPIRY_DAYS = 13 // 缓存过期天数
const EXPIRY_MS = EXPIRY_DAYS * 24 * 60 * 60 * 1000 // 13 天对应的毫秒数

let dbPromise = null // 用于缓存 IndexedDB 连接

// --- IndexedDB Helper Functions ---

/**
 * 打开或创建 IndexedDB 数据库。
 * @returns {Promise<IDBDatabase>} IndexedDB 数据库实例的 Promise。
 */
function openMetadataDB() {
	if (dbPromise)
		return dbPromise

	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1) // 版本号为 1

		request.onupgradeneeded = event => {
			console.log('[SW DB] Database upgrade needed.')
			const db = event.target.result
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				// 创建对象存储空间，使用 URL 作为主键
				const store = db.createObjectStore(STORE_NAME, { keyPath: 'url' })
				// 创建一个 'timestamp' 索引，用于按时间查询
				store.createIndex('timestamp', 'timestamp', { unique: false })
				console.log('[SW DB] Object store and index created.')
			}
		}

		request.onsuccess = event => {
			resolve(event.target.result)
		}

		request.onerror = event => {
			console.error('[SW DB] Database open error:', event.target.error)
			dbPromise = null // 重置 Promise，以便下次重试
			reject(event.target.error)
		}
	})
	return dbPromise
}

/**
 * 更新或插入指定 URL 的时间戳。
 * @param {string} url 资源 URL。
 * @param {number} timestamp 时间戳 (Date.now())。
 * @returns {Promise<void>}
 */
async function updateTimestamp(url, timestamp) {
	try {
		const db = await openMetadataDB()
		const transaction = db.transaction(STORE_NAME, 'readwrite')
		const store = transaction.objectStore(STORE_NAME)
		await store.put({ url, timestamp }) // put 会覆盖或插入
		await transaction.complete // 等待事务完成 (IndexedDB v2+) 或使用 oncomplete
		// console.log(`[SW DB] Timestamp updated for: ${url}`); // 可选：过于频繁的日志
	} catch (error) {
		console.error(`[SW DB] Failed to update timestamp for ${url}:`, error)
		// 即使时间戳更新失败，也不应中断主要流程
	}
}

let cleanupTimeout
/**
 * 清理过期的缓存和对应的元数据。
 * @returns {Promise<void>}
 */
async function cleanupExpiredCache() {
	console.log('[SW Cleanup] Starting cache cleanup...')
	const now = Date.now()
	const expiryThreshold = now - EXPIRY_MS
	let db
	let cache

	try {
		db = await openMetadataDB()
		cache = await caches.open(CACHE_NAME) // 打开主缓存

		const transaction = db.transaction(STORE_NAME, 'readwrite') // 需要读写权限来删除
		const store = transaction.objectStore(STORE_NAME)
		const index = store.index('timestamp') // 使用时间戳索引

		// 创建一个范围，选择所有时间戳小于阈值的记录
		const range = IDBKeyRange.upperBound(expiryThreshold)
		let deletedCount = 0

		// 使用游标迭代旧记录
		// Using Promise wrapper for cursor iteration
		await new Promise((resolve, reject) => {
			const cursorRequest = index.openCursor(range)

			cursorRequest.onsuccess = event => {
				const cursor = event.target.result
				if (cursor) {
					const record = cursor.value
					// 1. 从主缓存中删除
					cache.delete(record.url)
						.then(deleted => {
							if (deleted) {
								// 2. 如果缓存删除成功，则从 IndexedDB 中删除元数据
								const deleteRequest = cursor.delete() // 使用游标删除当前记录
								deleteRequest.onsuccess = () => {
									deletedCount++
									// console.log(`[SW Cleanup] Deleted metadata for: ${record.url}`); // 可选：日志过于详细
								}
								deleteRequest.onerror = (e) => {
									console.error(`[SW Cleanup] Failed to delete metadata for ${record.url}:`, e.target.error)
								}
							} else {
								console.warn(`[SW Cleanup] Item not found in cache, deleting metadata anyway: ${record.url}`)
								// 即使缓存中没有，也尝试删除元数据记录
								const deleteRequest = cursor.delete()
								deleteRequest.onerror = (e) => {
									console.error(`[SW Cleanup] Failed to delete metadata (after cache miss) for ${record.url}:`, e.target.error)
								}
							}
						})
						.catch(err => {
							console.error(`[SW Cleanup] Failed to delete from cache for ${record.url}:`, err)
							// 如果缓存删除失败，暂时不删除元数据，留待下次清理
						})
						.finally(() => {
							cursor.continue() // 继续下一个记录
						})
				} else
					// 游标结束
					resolve()
			}

			cursorRequest.onerror = event => {
				console.error('[SW Cleanup] Error iterating expired items:', event.target.error)
				reject(event.target.error)
			}
		})

		await transaction.complete // 等待事务完成
		console.log(`[SW Cleanup] Cache cleanup finished. Deleted ${deletedCount} expired items.`)

	} catch (error) {
		console.error('[SW Cleanup] Cache cleanup failed:', error)
		// 如果数据库或缓存打开失败，则无法清理
	}
	cleanupTimeout = undefined
}

// --- Service Worker Event Listeners ---

// 安装阶段：跳过等待，立即激活。
self.addEventListener('install', event => {
	console.log(`[SW ${CACHE_NAME}] Installing...`)
	// 强制新的 Service Worker 跳过等待阶段，安装后立即激活
	event.waitUntil(self.skipWaiting())
})

// 激活阶段：接管客户端控制权，移除旧版本缓存，并执行一次缓存清理。
self.addEventListener('activate', event => {
	console.log(`[SW ${CACHE_NAME}] Activating...`)
	event.waitUntil(
		Promise.all([
			// 让当前 Service Worker 控制所有本应由它控制的页面
			self.clients.claim()
		])
			.then(() => console.log(`[SW ${CACHE_NAME}] Activation successful.`))
			.catch(error => console.error(`[SW ${CACHE_NAME}] Activation failed:`, error))
	)
})

// 拦截网络请求：Stale-While-Revalidate 策略，并更新时间戳
self.addEventListener('fetch', event => {
	// 只处理 GET 请求
	if (event.request.method !== 'GET') return

	const requestUrl = new URL(event.request.url) // Parse the full URL
	const { pathname, href: url } = requestUrl // Keep the full URL string for logging/keys if needed

	// 对于扩展程序等的请求，不进行拦截
	if (!url.startsWith('http')) return
	// 对于/api/请求，不进行拦截
	if (pathname.startsWith('/api/')) return

	event.respondWith(
		caches.open(CACHE_NAME).then(async cache => { // 使用 async 以便 await
			// 尝试从缓存中匹配请求
			const cachedResponse = await cache.match(event.request)
			const now = Date.now()

			// 启动网络请求 (Revalidate 部分)
			const fetchPromise = fetch(event.request)
				.then(networkResponse => {
					// 检查网络响应是否有效且可缓存
					if (!networkResponse || !networkResponse.ok || networkResponse.type === 'opaque') {
						if (networkResponse && networkResponse.type === 'opaque')
							console.log(`[SW ${CACHE_NAME}] Received Opaque response for: ${url}. Will not cache.`)
						else
							console.warn(`[SW ${CACHE_NAME}] Network request failed or response not cacheable: ${url}. Status: ${networkResponse ? networkResponse.status : 'N/A'}`)

						// 即使响应无效，也返回它，浏览器会处理
						return networkResponse
					}

					// 克隆响应用于缓存
					const responseToCache = networkResponse.clone()
					const finalUrl = networkResponse.url // 获取最终 URL（可能因重定向而不同）

					// 存入缓存并更新时间戳
					cache.put(finalUrl, responseToCache) // 使用最终 URL 作为键
						.then(() => {
							return updateTimestamp(finalUrl, now) // 使用最终 URL
						})
						.then(() => {
							// 缓存和时间戳更新成功后，触发一次清理（非阻塞）
							// 使用 setTimeout 将清理推迟到当前事件处理循环之后，避免阻塞响应
							if (cleanupTimeout) clearTimeout(cleanupTimeout)
							setTimeout(cleanupExpiredCache, 1000)
						})
						.catch(err => {
							console.error(`[SW ${CACHE_NAME}] Failed to cache or update timestamp for ${finalUrl}:`, err)
						})

					// 返回原始网络响应给页面
					return networkResponse
				})
				.catch(error => {
					// 网络请求本身失败（例如，离线）
					console.warn(`[SW ${CACHE_NAME}] Network fetch failed for: ${url}:`, error)
					// 如果 fetch 失败，并且没有缓存响应，则必须抛出错误
					if (!cachedResponse)
						throw error

					// 如果有缓存响应（已返回或将返回），则捕获错误，避免中断
					// Stale-While-Revalidate 策略在这种情况下会继续提供旧缓存
					return null // 返回 null 或其他标记，表示网络部分失败但有缓存
				})

			// 如果缓存命中 (Stale 部分)
			if (cachedResponse) {
				// 更新缓存项的访问时间戳（即使是旧的）
				updateTimestamp(cachedResponse.url || url, now) // 使用缓存响应的 URL 或原始请求 URL
				return cachedResponse // 立即返回缓存响应
			}

			// 如果缓存未命中
			// 等待网络请求结果 (fetchPromise)
			// 如果 fetchPromise 解析为 null（网络错误但有缓存已处理），则不会执行到这里
			// 如果 fetchPromise 抛出错误（网络错误且无缓存），错误会传播到 respondWith
			return await fetchPromise
		})
	)
})
