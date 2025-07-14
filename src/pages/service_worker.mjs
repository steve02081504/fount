// --- 全局常量与配置 ---

/**
 * @description 缓存存储的名称。更改此值将触发 Service Worker 的更新流程。
 * @type {string}
 */
const CACHE_NAME = 'fount'

/**
 * @description 用于存储缓存元数据（如时间戳）的 IndexedDB 数据库名称。
 * @type {string}
 */
const DB_NAME = 'service-worker-cache-metadata'

/**
 * @description IndexedDB 中用于存储时间戳记录的对象存储空间（Object Store）名称。
 * @type {string}
 */
const STORE_NAME = 'timestamps'

/**
 * @description 缓存资源的过期天数。
 * @type {number}
 */
const EXPIRY_DAYS = 13

/**
 * @description 缓存过期天数对应的毫秒数。
 * @type {number}
 */
const EXPIRY_MS = EXPIRY_DAYS * 24 * 60 * 60 * 1000

/**
 * @description 后台网络请求的节流时间（毫秒）。
 * 在此时间内，对于同一个资源，即使缓存存在，也只会在后台发起一次网络请求进行更新，以节省带宽和电量。
 * @type {number}
 */
const BACKGROUND_FETCH_THROTTLE_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * @description 用于注册定期后台同步任务的唯一标签，专用于缓存清理。
 * @type {string}
 */
const PERIODIC_SYNC_TAG = `${CACHE_NAME}-cleanup`

/**
 * @description 用于缓存 IndexedDB 数据库连接的 Promise。
 * 避免重复打开数据库，提高性能。当连接关闭或发生错误时，此变量将被重置为 null。
 * @type {Promise<IDBDatabase> | null}
 */
let dbPromise = null


// --- IndexedDB 辅助函数 ---

/**
 * @description 打开或创建 IndexedDB 数据库。
 * 此函数会缓存数据库连接的 Promise，以避免不必要的重复连接。
 * 包含了完整的事件处理（onupgradeneeded, onsuccess, onerror, onclose, onblocked）。
 * @returns {Promise<IDBDatabase>} 返回一个解析为 IndexedDB 数据库实例的 Promise。
 */
function openMetadataDB() {
	if (dbPromise)
		return dbPromise

	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1)

		request.onupgradeneeded = event => {
			console.log('[SW DB] Database upgrade needed.')
			const db = event.target.result
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, { keyPath: 'url' })
				// 创建 'timestamp' 索引，用于高效查询过期项目。
				store.createIndex('timestamp', 'timestamp', { unique: false })
				console.log('[SW DB] Object store and index created.')
			}
		}

		request.onsuccess = event => {
			const db = event.target.result
			// 监听数据库连接意外关闭的事件，以便在发生时重置 dbPromise。
			db.onclose = () => {
				console.warn('[SW DB] Database connection closed unexpectedly.')
				dbPromise = null
			}
			// 监听数据库错误事件。
			db.onerror = (event) => {
				console.error('[SW DB] Database error:', event.target.error)
				dbPromise = null
			}
			resolve(db)
		}

		request.onerror = event => {
			console.error('[SW DB] Database open error:', event.target.error)
			dbPromise = null // 打开失败时也重置
			reject(event.target.error)
		}

		request.onblocked = () => {
			// 当其他页面持有未关闭的旧版本数据库连接时，会触发此事件。
			console.warn('[SW DB] Database open blocked. Please close other tabs using the database.')
		}
	})
	return dbPromise
}

/**
 * @description 封装一个通用的 IndexedDB 事务执行函数。
 * 抽象了事务的创建、对象存储的获取以及完成/错误处理，使业务逻辑更清晰。
 * @param {IDBTransactionMode} mode - 事务模式，'readonly' 或 'readwrite'。
 * @param {(store: IDBObjectStore) => void} callback - 一个在事务上下文中执行的回调函数，接收对象存储作为参数。
 * @returns {Promise<void>} 在事务成功完成时解析，在失败时拒绝。
 */
async function performTransaction(mode, callback) {
	try {
		const db = await openMetadataDB()
		const transaction = db.transaction(STORE_NAME, mode)
		const store = transaction.objectStore(STORE_NAME)

		callback(store)

		return new Promise((resolve, reject) => {
			transaction.oncomplete = () => resolve()
			transaction.onerror = () => reject(transaction.error)
			transaction.onabort = () => reject(new Error('Transaction aborted'))
		})
	} catch (error) {
		console.error(`[SW DB] Transaction failed with mode ${mode}:`, error)
		throw error // 将异常向上抛出，以便调用者可以处理。
	}
}

/**
 * @description 向 IndexedDB 中更新或插入指定 URL 的时间戳。
 * @param {string} url - 资源的 URL，作为主键。
 * @param {number} timestamp - 当前的时间戳 (Date.now())。
 * @returns {Promise<void>}
 */
async function updateTimestamp(url, timestamp) {
	try {
		await performTransaction('readwrite', store => {
			store.put({ url, timestamp })
		})
	} catch (error) {
		console.error(`[SW DB] Failed to update timestamp for ${url}:`, error)
	}
}

/**
 * @description 从 IndexedDB 中获取指定 URL 的时间戳。
 * @param {string} url - 资源的 URL。
 * @returns {Promise<number | null>} 返回找到的时间戳，如果未找到则返回 null。
 */
async function getTimestamp(url) {
	try {
		const db = await openMetadataDB()
		const transaction = db.transaction(STORE_NAME, 'readonly')
		const store = transaction.objectStore(STORE_NAME)
		const request = store.get(url)

		return new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result ? request.result.timestamp : null)
			request.onerror = () => reject(request.error)
		})
	} catch (error) {
		console.error(`[SW DB] Failed to get timestamp for ${url}:`, error)
		return null
	}
}

/**
 * @description 清理过期的缓存和 IndexedDB 中的元数据。
 * 这是一个安全的两步操作：
 * 1. 在一个原子性的 IndexedDB 事务中，查找并删除所有过期的元数据记录。
 * 2. 只有在数据库事务成功提交后，才开始从 Cache Storage 中删除对应的缓存资源。
 * 这种方式确保了数据的一致性，避免了只删除缓存而未删除元数据（或反之）的情况。
 * @returns {Promise<void>}
 */
async function cleanupExpiredCache() {
	const now = Date.now()
	const expiryThreshold = now - EXPIRY_MS
	const urlsToDelete = []

	try {
		// 步骤 1: 在单个事务中原子化地识别并删除过期的元数据。
		const db = await openMetadataDB()
		const transaction = db.transaction(STORE_NAME, 'readwrite')
		const store = transaction.objectStore(STORE_NAME)
		const index = store.index('timestamp')
		const range = IDBKeyRange.upperBound(expiryThreshold)

		await new Promise((resolve, reject) => {
			const cursorRequest = index.openCursor(range)
			cursorRequest.onerror = event => reject(event.target.error)
			cursorRequest.onsuccess = event => {
				const cursor = event.target.result
				if (cursor) {
					urlsToDelete.push(cursor.value.url)
					cursor.delete() // 在遍历过程中直接删除，此操作属于当前事务。
					cursor.continue()
				} else
					resolve() // 游标遍历完成。

			}
		})

		// 等待事务完成，以确保所有数据库删除操作都已成功提交。
		await new Promise((resolve, reject) => {
			transaction.oncomplete = resolve
			transaction.onerror = reject
			transaction.onabort = () => reject(new Error('Cleanup transaction aborted'))
		})

		if (urlsToDelete.length === 0)
			return

		// 步骤 2: 在数据库清理成功后，安全地清理 Cache Storage。
		const cache = await caches.open(CACHE_NAME)
		let deletedCount = 0
		for (const url of urlsToDelete)
			if (await cache.delete(url))
				deletedCount++
	} catch (error) {
		console.error('[SW Cleanup] Cache cleanup process failed:', error)
	}
}


// --- 缓存策略 ---

/**
 * @description 缓存优先策略（Cache-First），结合了后台更新和节流。
 * 这是一个 Stale-While-Revalidate 策略的变体。
 * 1. 如果缓存中存在响应，立即返回它。
 * 2. 同时，在后台检查是否需要发起网络请求来更新缓存。
 * 3. 后台更新受 `BACKGROUND_FETCH_THROTTLE_MS` 常量节流，避免在短时间内对同一资源进行重复请求。
 * @param {Request} request - fetch 事件中的请求对象。
 * @returns {Promise<Response>} 返回一个解析为 Response 对象的 Promise。
 */
async function handleCacheFirst(request) {
	const { url } = request
	const cache = await caches.open(CACHE_NAME)
	const cachedResponse = await cache.match(request)

	const now = Date.now()
	let shouldFetchInBackground = true
	const storedTimestamp = await getTimestamp(url)

	// 如果最近已经进行过后台更新，则跳过本次更新。
	if (storedTimestamp && (now - storedTimestamp < BACKGROUND_FETCH_THROTTLE_MS))
		shouldFetchInBackground = false

	// 定义一个在后台执行的网络请求和缓存更新任务。
	const backgroundUpdateTask = async () => {
		if (!shouldFetchInBackground)
			return null
		try {
			const networkResponse = await fetch(request)
			// 仅缓存有效的、非不透明的响应。
			if (networkResponse && networkResponse.ok && networkResponse.type !== 'opaque') {
				const responseToCache = networkResponse.clone()
				await cache.put(request, responseToCache)
				await updateTimestamp(url, Date.now())
			}
			else if (networkResponse && networkResponse.type !== 'opaque')
				console.warn(`[SW ${CACHE_NAME}] Background fetch for ${url} responded with ${networkResponse.status} ${networkResponse.statusText}. Not caching.`)

			return networkResponse // 返回网络响应，供无缓存时使用。
		} catch (error) {
			console.warn(`[SW ${CACHE_NAME}] Background network fetch failed for ${url}:`, error)
			return null
		}
	}

	// 启动后台更新任务，不阻塞主流程。
	const networkPromise = backgroundUpdateTask()

	if (cachedResponse) return cachedResponse // 如果有缓存，立即返回。

	const networkResponse = await networkPromise
	if (networkResponse) return networkResponse

	// 当缓存和网络都失败时，抛出错误。
	throw new Error(`Failed to fetch ${url} from both cache and network.`)
}

/**
 * @description 网络优先策略（Network-First）。
 * 1. 总是先尝试从网络获取最新资源。
 * 2. 如果网络请求成功，返回该响应，并异步地更新缓存。
 * 3. 如果网络请求失败（例如，离线），则尝试从缓存中提供备用响应。
 * @param {Request} request - fetch 事件中的请求对象。
 * @returns {Promise<Response>} 返回一个解析为 Response 对象的 Promise。
 */
async function handleNetworkFirst(request) {
	const { url } = request
	try {
		const networkResponse = await fetch(request)

		// 仅缓存成功的、非不透明的响应。
		if (networkResponse && networkResponse.ok && networkResponse.type !== 'opaque') {
			const cache = await caches.open(CACHE_NAME)
			const responseToCache = networkResponse.clone();
			// 异步更新缓存，不阻塞对客户端的响应。
			(async () => {
				await cache.put(request, responseToCache)
				await updateTimestamp(url, Date.now())
			})()
		}

		return networkResponse
	} catch (error) {
		console.warn(`[SW ${CACHE_NAME}] Network fetch failed for ${url}. Attempting to serve from cache.`)
		const cache = await caches.open(CACHE_NAME)
		const cachedResponse = await cache.match(request)
		if (cachedResponse) return cachedResponse
		console.error(`[SW ${CACHE_NAME}] Cache miss after network failure for: ${url}.`)
		throw error
	}
}


// --- 路由表 ---
/**
 * @description 使用路由表来管理请求处理逻辑。
 * 这种方式比使用 if-else 链更具声明性、可读性和可扩展性。
 * `fetch` 事件处理器会按顺序遍历此数组，并执行第一个匹配规则的处理器。
 * @type {Array<{condition: (context: {event: FetchEvent, request: Request, url: URL}) => boolean, handler: (context: {event: FetchEvent, request: Request, url: URL}) => Promise<Response> | null}>}
 */
const routes = [
	// 忽略所有非 GET 请求。
	{
		condition: ({ request }) => request.method !== 'GET',
		handler: () => null, // 返回 null 表示跳过，让浏览器自行处理。
	},
	// 忽略非 http/https 协议的请求（例如 chrome-extension://）。
	{
		condition: ({ url }) => !url.protocol.startsWith('http'),
		handler: () => null,
	},
	// 对所有跨域资源（通常是 CDN 上的静态文件）使用缓存优先策略。
	{
		condition: ({ url }) => url.origin !== self.location.origin,
		handler: ({ event }) => handleCacheFirst(event.request),
	},
	// 默认规则，对所有同源资源使用网络优先策略。
	{
		condition: () => true, // 始终匹配，作为最后的 fallback。
		handler: ({ event }) => handleNetworkFirst(event.request),
	},
]


// --- Service Worker 事件监听器 ---

self.addEventListener('install', event => {
	console.log(`[SW ${CACHE_NAME}] Installing...`)
	// `self.skipWaiting()` 强制新的 Service Worker 在安装后立即激活，
	// 取代旧的 Service Worker，而无需等待页面重新加载。
	event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', event => {
	event.waitUntil(
		(async () => {
			// 注册定期后台同步任务，用于自动清理过期缓存。
			// Periodic Background Sync API 比 setTimeout 更可靠，因为它由操作系统调度，
			// 即使 Service Worker 终止也能在适当的时候被唤醒执行。
			if ('periodicSync' in self.registration)
				try {
					await self.registration.periodicSync.register(PERIODIC_SYNC_TAG, {
						minInterval: 24 * 60 * 60 * 1000, // 至少每 24 小时执行一次。
					})
				} catch (err) {
					console.error('[SW] Periodic background sync failed to register:', err)
				}

			// `self.clients.claim()` 确保新的 Service Worker 立即控制所有当前打开的客户端（页面）。
			await self.clients.claim()
			// 在激活时立即执行一次清理，以处理可能在 SW 非活动期间过期的项目。
			await cleanupExpiredCache()
		})()
	)
})

/**
 * @description 监听定期后台同步事件。
 * 当浏览器认为条件合适（例如网络连接良好，电量充足）且达到了最小间隔时间时，会触发此事件。
 */
self.addEventListener('periodicsync', event => {
	if (event.tag === PERIODIC_SYNC_TAG)
		// 仅当事件标签与我们注册的清理任务标签匹配时，才执行清理操作。
		event.waitUntil(cleanupExpiredCache())
})

/**
 * @description 拦截所有网络请求。
 * 这是 Service Worker 的核心功能。
 */
self.addEventListener('fetch', event => {
	const requestUrl = new URL(event.request.url)

	// 遍历路由表，为请求寻找合适的处理器。
	for (const route of routes)
		if (route.condition({ event, request: event.request, url: requestUrl })) {
			const handlerResult = route.handler({ event, request: event.request, url: requestUrl })
			// 如果处理器返回一个 Promise<Response>，则使用它来响应请求。
			if (handlerResult) {
				event.respondWith(handlerResult)
				return // 找到匹配的处理器后，终止循环。
			}
			// 如果处理器返回 null，则表示跳过 Service Worker 的处理，
			// 让请求按照浏览器的默认行为继续。通过 return 退出监听器即可实现。
			return
		}
})
