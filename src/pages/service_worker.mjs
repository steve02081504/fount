// --- 全局常量与配置 ---

/**
 * 缓存存储的名称。更改此值将触发 Service Worker 的更新流程。
 * @type {string}
 */
const CACHE_NAME = 'fount'

/**
 * 用于存储缓存元数据（如时间戳）的 IndexedDB 数据库名称。
 * @type {string}
 */
const DB_NAME = 'service-worker-cache-metadata'

/**
 * IndexedDB 中用于存储时间戳记录的对象存储空间（Object Store）名称。
 * @type {string}
 */
const STORE_NAME = 'timestamps'

/**
 * 缓存资源的过期天数。
 * @type {number}
 */
const EXPIRY_DAYS = 13

/**
 * 缓存过期天数对应的毫秒数。
 * @type {number}
 */
const EXPIRY_MS = EXPIRY_DAYS * 24 * 60 * 60 * 1000

/**
 * 后台网络请求的节流时间（毫秒）。
 * 在此时间内，对于同一个资源，即使缓存存在，也只会在后台发起一次网络请求进行更新，以节省带宽和电量。
 * @type {number}
 */
const BACKGROUND_FETCH_THROTTLE_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * 用于注册定期后台同步任务的唯一标签，专用于缓存清理。
 * @type {string}
 */
const PERIODIC_SYNC_TAG = `${CACHE_NAME}-cleanup`

/**
 * 用于缓存 IndexedDB 数据库连接的 Promise。
 * 避免重复打开数据库，提高性能。当连接关闭或发生错误时，此变量将被重置为 null。
 * @type {Promise<IDBDatabase> | null}
 */
let dbPromise = null


// --- IndexedDB 辅助函数 ---

/**
 * 打开或创建 IndexedDB 数据库。
 * 此函数会缓存数据库连接的 Promise，以避免不必要的重复连接。
 * 包含了完整的事件处理（onupgradeneeded, onsuccess, onerror, onclose, onblocked）。
 * @returns {Promise<IDBDatabase>} 返回一个解析为 IndexedDB 数据库实例的 Promise。
 */
function openMetadataDB() {
	if (dbPromise)
		return dbPromise

	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1)

		/**
		 * 当数据库需要升级时调用。
		 * @param {IDBVersionChangeEvent} event - 事件对象。
		 * @returns {void}
		 */
		request.onupgradeneeded = event => {
			console.log('[SW DB] Database upgrade needed.')
			const db = event.target.result
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, { keyPath: 'url' })
				store.createIndex('timestamp', 'timestamp', { unique: false })
				console.log('[SW DB] Object store and index created.')
			}
		}

		/**
		 * 当数据库成功打开时调用。
		 * @param {Event} event - 事件对象。
		 * @returns {void}
		 */
		request.onsuccess = event => {
			const db = event.target.result
			/**
			 * 当数据库连接意外关闭时调用。
			 * @returns {void}
			 */
			db.onclose = () => {
				console.warn('[SW DB] Database connection closed unexpectedly.')
				dbPromise = null
			}
			/**
			 * 当数据库发生错误时调用。
			 * @param {Event} event - 事件对象。
			 * @returns {void}
			 */
			db.onerror = event => {
				console.error('[SW DB] Database error:', event.target.error)
				dbPromise = null
			}
			resolve(db)
		}

		/**
		 * 当数据库打开失败时调用。
		 * @param {Event} event - 事件对象。
		 * @returns {void}
		 */
		request.onerror = event => {
			console.error('[SW DB] Database open error:', event.target.error)
			dbPromise = null
			reject(event.target.error)
		}

		/**
		 * 当数据库被阻塞时调用。
		 * @returns {void}
		 */
		request.onblocked = () => {
			console.warn('[SW DB] Database open blocked. Please close other tabs using the database.')
		}
	})
	return dbPromise
}

/**
 * 封装一个通用的 IndexedDB 事务执行函数。
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
			/**
			 * 当事务成功完成时调用。
			 * @returns {void}
			 */
			transaction.oncomplete = () => resolve()
			/**
			 * 当事务发生错误时调用。
			 * @returns {void}
			 */
			transaction.onerror = () => reject(transaction.error)
			/**
			 * 当事务被中止时调用。
			 * @returns {void}
			 */
			transaction.onabort = () => reject(new Error('Transaction aborted'))
		})
	}
	catch (error) {
		console.error(`[SW DB] Transaction failed with mode ${mode}:`, error)
		throw error
	}
}

/**
 * 向 IndexedDB 中更新或插入指定 URL 的时间戳。
 * @param {string} url - 资源的 URL，作为主键。
 * @param {number} timestamp - 当前的时间戳 (Date.now())。
 * @returns {Promise<void>}
 */
async function updateTimestamp(url, timestamp) {
	try {
		await performTransaction('readwrite', store => {
			store.put({ url, timestamp })
		})
	}
	catch (error) {
		console.error(`[SW DB] Failed to update timestamp for ${url}:`, error)
	}
}

/**
 * 从 IndexedDB 中获取指定 URL 的时间戳。
 * 此函数通过复用 `performTransaction` 来简化事务管理，并利用闭包从异步回调中捕获结果。
 * @param {string} url - 资源的 URL。
 * @returns {Promise<number | null>} 返回找到的时间戳，如果未找到或发生错误则返回 null。
 */
async function getTimestamp(url) {
	let timestamp = null // 在外部作用域定义变量以捕获事务内的结果
	try {
		await performTransaction('readonly', store => {
			const request = store.get(url)
			/**
			 * 当获取操作成功时调用。
			 * @returns {void}
			 */
			request.onsuccess = () => {
				if (request.result)
					timestamp = request.result.timestamp
			}
		})
		return timestamp // 返回在事务中成功获取的值
	}
	catch (error) {
		console.error(`[SW DB] Failed to get timestamp for ${url}:`, error)
		return null // 保持错误处理行为不变
	}
}

/**
 * 清理过期的缓存和 IndexedDB 中的元数据。
 * 这是一个安全的两步操作：
 * 1. 在一个原子性的 IndexedDB 事务中，查找并删除所有过期的元数据记录。
 * 2. 数据库事务成功后，并行地从 Cache Storage 中删除对应的缓存资源以提高效率。
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

		// 步骤 1: 在单个事务中原子化地识别并删除过期的元数据。
		await new Promise((resolve, reject) => {
			const cursorRequest = index.openCursor(range)
			/**
			 * 当游标操作发生错误时调用。
			 * @param {Event} event - 事件对象。
			 * @returns {void}
			 */
			cursorRequest.onerror = event => reject(event.target.error)
			/**
			 * 当游标操作成功时调用。
			 * @param {Event} event - 事件对象。
			 * @returns {void}
			 */
			cursorRequest.onsuccess = event => {
				const cursor = event.target.result
				if (cursor) {
					urlsToDelete.push(cursor.value.url)
					cursor.delete()
					cursor.continue()
				}
				else resolve()
			}
		})

		// 等待事务完成，确保所有数据库删除操作已提交。
		await new Promise((resolve, reject) => {
			transaction.oncomplete = resolve
			transaction.onerror = reject
			/**
			 * 当事务被中止时调用。
			 * @returns {void}
			 */
			transaction.onabort = () => reject(new Error('Cleanup transaction aborted'))
		})

		if (!urlsToDelete.length) return

		// 步骤 2: 并行删除缓存条目，以提高清理大量项目时的效率。
		const cache = await caches.open(CACHE_NAME)
		const deletePromises = urlsToDelete.map(url => cache.delete(url))
		// 使用 Promise.allSettled 确保即使某个删除失败，其他删除操作也能继续完成。
		await Promise.allSettled(deletePromises)
	}
	catch (error) {
		console.error('[SW Cleanup] Cache cleanup process failed:', error)
	}
}

/**
 * 获取资源并智能地处理缓存和重定向。
 * 这是解决重定向问题的核心。它会正确地缓存重定向响应和最终内容。
 * @param {Request} request - 要获取和缓存的请求。
 * @returns {Promise<Response>} 返回一个适合直接响应给浏览器的 Response 对象。
 */
async function fetchAndCache(request) {
	try {
		const cache = await caches.open(CACHE_NAME)
		let error, networkResponse = await fetch(request).catch(_ => { error = _ })
		if (networkResponse?.type === 'opaque' || !networkResponse?.ok) {
			const cachedResponse = await cache.match(request)
			const can_cors = cachedResponse ? cachedResponse.headers.get('Access-Control-Allow-Origin') : new URL(request.url).origin !== self.location.origin && await fetch(request.url, { method: 'HEAD' }).then(response => response.headers.get('Access-Control-Allow-Origin')).catch(_ => null)
			const newNetworkResponse = await fetch(request.url, { ...request, mode: can_cors ? 'cors' : request.mode === 'no-cors' ? 'no-cors' : undefined, url: undefined }).catch(_ => { error = _ })
			if (newNetworkResponse?.ok) networkResponse = newNetworkResponse
			else if (error) throw error
		}

		if (networkResponse.type == 'opaque');
		else if (networkResponse && networkResponse.ok) {
			const responseToCache = networkResponse.clone()
			const now = Date.now()

			if (networkResponse.redirected) {
				await cache.put(networkResponse.url, responseToCache)
				await updateTimestamp(networkResponse.url, now)

				const redirectResponse = Response.redirect(networkResponse.url, 301)

				await cache.put(request, redirectResponse.clone())
				await updateTimestamp(request.url, now)

				return redirectResponse
			}
			else {
				await cache.put(request, responseToCache)
				await updateTimestamp(request.url, now)
			}
		}
		else if (networkResponse)
			console.warn(`[SW ${CACHE_NAME}] Fetch for ${request.url} responded with ${networkResponse.status} ${networkResponse.statusText}. Not caching.`)

		return networkResponse
	}
	catch (error) {
		console.error(`[SW ${CACHE_NAME}] fetchAndCache failed for ${request.url}:`, error)
		throw error
	}
}

// --- 缓存策略 ---

/**
 * 缓存优先策略（Cache-First），结合了后台更新和节流。
 * 这是一个 Stale-While-Revalidate 策略的变体，能立即从缓存响应，同时在后台更新资源。
 * @param {Request} request - fetch 事件中的请求对象。
 * @returns {Promise<Response>} 返回一个解析为 Response 对象的 Promise。
 */
async function handleCacheFirst(request) {
	const cache = await caches.open(CACHE_NAME)
	const cachedResponse = await cache.match(request)

	const now = Date.now()
	const storedTimestamp = await getTimestamp(request.url)
	const isThrottled = storedTimestamp && (now - storedTimestamp < BACKGROUND_FETCH_THROTTLE_MS)

	/**
	 * 在后台更新缓存。
	 * @returns {Promise<void>}
	 */
	const backgroundUpdateTask = async () => {
		if (!isThrottled) try {
			await fetchAndCache(request.clone())
		} catch (error) {
			console.warn(`[SW ${CACHE_NAME}] Background network fetch failed for ${request.url}:`, error)
		}
	}

	if (cachedResponse) {
		backgroundUpdateTask()
		return cachedResponse
	}

	try {
		return await fetchAndCache(request)
	}
	catch (error) {
		console.error(`[SW ${CACHE_NAME}] Failed to fetch ${request.url} from network after cache miss.`)
		throw error
	}
}

/**
 * 网络优先策略（Network-First）。
 * 优先从网络获取最新资源，如果网络失败，则回退到缓存。
 * @param {Request} request - fetch 事件中的请求对象。
 * @returns {Promise<Response>} 返回一个解析为 Response 对象的 Promise。
 */
async function handleNetworkFirst(request) {
	try {
		return await fetchAndCache(request)
	}
	catch (error) {
		console.warn(`[SW ${CACHE_NAME}] Network fetch failed for ${request.url}. Attempting to serve from cache.`)
		const cache = await caches.open(CACHE_NAME)
		const cachedResponse = await cache.match(request)
		if (cachedResponse) return cachedResponse
		console.error(`[SW ${CACHE_NAME}] Cache miss after network failure for: ${request.url}.`)
		throw error
	}
}


// --- 路由表 ---
/**
 * 使用路由表来管理请求处理逻辑。
 * `fetch` 事件处理器会遍历此数组，并执行第一个匹配规则的处理器。
 * @type {Array<{condition: (context: {event: FetchEvent, request: Request, url: URL}) => boolean, handler: (context: {event: FetchEvent, request: Request, url: URL}) => Promise<Response> | null}>}
 */
const routes = [
	// 忽略所有非 GET 请求。
	{
		/**
		 * 检查请求方法是否为 GET。
		 * @param {object} context - 上下文对象。
		 * @param {Request} context.request - 请求对象。
		 * @returns {boolean} 如果请求方法不是 GET，则返回 true。
		 */
		condition: ({ request }) => request.method !== 'GET',
		/**
		 * 处理非 GET 请求。
		 * @returns {null} 返回 null 以跳过处理。
		 */
		handler: () => null, // 返回 null 表示跳过，让浏览器自行处理。
	},
	// 忽略非 http/https 协议的请求（例如 chrome-extension://）。
	{
		/**
		 * 检查 URL 协议是否为 http 或 https。
		 * @param {object} context - 上下文对象。
		 * @param {URL} context.url - URL 对象。
		 * @returns {boolean} 如果协议不是 http 或 https，则返回 true。
		 */
		condition: ({ url }) => !url.protocol.startsWith('http'),
		/**
		 * 处理非 http/https 请求。
		 * @returns {null} 返回 null 以跳过处理。
		 */
		handler: () => null,
	},
	// 对所有跨域资源（通常是 CDN 上的静态文件）使用缓存优先策略。
	{
		/**
		 * 检查请求是否为跨域请求。
		 * @param {object} context - 上下文对象。
		 * @param {URL} context.url - URL 对象。
		 * @returns {boolean} 如果请求是跨域的，则返回 true。
		 */
		condition: ({ url }) => url.origin !== self.location.origin,
		/**
		 * 处理跨域请求。
		 * @param {object} context - 上下文对象。
		 * @param {FetchEvent} context.event - Fetch 事件。
		 * @returns {Promise<Response>} 返回一个解析为 Response 对象的 Promise。
		 */
		handler: ({ event }) => handleCacheFirst(event.request),
	},
	// 默认规则：对所有同源资源使用网络优先策略。
	{
		/**
		 * 默认条件。
		 * @returns {boolean} 总是返回 true。
		 */
		condition: () => true, // 作为最后的 fallback 规则。
		/**
		 * 处理同源请求。
		 * @param {object} context - 上下文对象。
		 * @param {FetchEvent} context.event - Fetch 事件。
		 * @returns {Promise<Response>} 返回一个解析为 Response 对象的 Promise。
		 */
		handler: ({ event }) => handleNetworkFirst(event.request),
	},
]


// --- WebSocket Notification Client ---

let ws = null
let reconnectTimeout = null
const RECONNECT_DELAY = 5000 // 5 seconds

const wsMessageHandlers = {
	/**
	 * 处理通知消息。
	 * @param {object} data - 消息数据。
	 * @returns {void}
	 */
	notification: data => {
		const { title, options, targetUrl } = data
		if (!title) return

		if (!targetUrl) self.registration.showNotification(title, options)
		else self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
			let shouldShowNotification = true
			for (const client of windowClients) {
				const clientUrl = new URL(client.url)
				const notificationTargetUrl = new URL(targetUrl, self.location.origin)
				if (clientUrl.pathname === notificationTargetUrl.pathname && clientUrl.search === notificationTargetUrl.search && client.focused) {
					shouldShowNotification = false
					break
				}
			}
			if (shouldShowNotification)
				self.registration.showNotification(title, options)
		})
	},
	/**
	 * 默认消息处理程序。
	 * @param {object} message - 消息对象。
	 * @returns {void}
	 */
	default: message => {
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
			for (const client of windowClients) client.postMessage(message)
		})
	},
}


/**
 * 连接到 WebSocket 服务器。
 * @returns {void}
 */
function connectWebSocket() {
	// Use a relative URL that will be resolved correctly by the browser
	// against the service worker's origin.
	const wsUrl = new URL('/ws/notify', self.location.href)
	wsUrl.protocol = wsUrl.protocol.replace('http', 'ws')

	ws = new WebSocket(wsUrl)

	/**
	 * 当 WebSocket 连接打开时调用。
	 * @returns {void}
	 */
	ws.onopen = () => {
		// Reset reconnect timeout on successful connection
		if (!reconnectTimeout) return
		clearTimeout(reconnectTimeout)
		reconnectTimeout = null
	}

	/**
	 * 当收到 WebSocket 消息时调用。
	 * @param {MessageEvent} event - 消息事件。
	 * @returns {void}
	 */
	ws.onmessage = event => {
		try {
			const message = JSON.parse(event.data)
			if (!message.type) return console.warn('[SW WS] Received message without a type:', message)

			const handler = wsMessageHandlers[message.type]
			if (handler) handler(message.data)
			else wsMessageHandlers.default(message)
		}
		catch (error) {
			console.error('[SW WS] Error parsing message or handling it:', error)
		}
	}

	/**
	 * 当 WebSocket 连接关闭时调用。
	 * @param {CloseEvent} event - 关闭事件。
	 * @returns {void}
	 */
	ws.onclose = event => {
		console.warn(`[SW WS] Connection closed. Code: ${event.code}, Reason: ${event.reason}. Reconnecting in ${RECONNECT_DELAY / 1000}s.`)
		ws = null
		if (!reconnectTimeout) reconnectTimeout = setTimeout(connectWebSocket, RECONNECT_DELAY)
	}

	/**
	 * 当 WebSocket 发生错误时调用。
	 * @param {Event} error - 错误事件。
	 * @returns {void}
	 */
	ws.onerror = error => {
		console.error('[SW WS] WebSocket error:', error)
	}
}

// Start WebSocket connection
connectWebSocket()

// --- Service Worker 事件监听器 ---

self.addEventListener('install', event => {
	// 强制新的 Service Worker 在安装后立即激活，取代旧版本。
	event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', event => {
	event.waitUntil(
		(async () => {
			// 尝试注册定期后台同步任务，用于自动清理过期缓存。
			if ('periodicSync' in self.registration) try {
				await self.registration.periodicSync.register(PERIODIC_SYNC_TAG, {
					minInterval: 24 * 60 * 60 * 1000, // 至少每 24 小时执行一次。
				})
			} catch (err) {
				if (err.name === 'NotAllowedError') return
				console.error('[SW] Periodic background sync failed to register:', err)
			}

			// 确保新的 Service Worker 立即控制所有当前打开的客户端（页面）。
			await self.clients.claim()
			// 在激活时立即执行一次清理，以处理可能在 SW 非活动期间过期的项目。
			await cleanupExpiredCache()
		})()
	)
})

/**
 * 监听定期后台同步事件，用于执行缓存清理。
 */
self.addEventListener('periodicsync', event => {
	// 确保只响应该 Service Worker 注册的清理任务。
	if (event.tag === PERIODIC_SYNC_TAG)
		event.waitUntil(cleanupExpiredCache())
})

self.addEventListener('notificationclick', event => {
	event.notification.close()
	const urlToOpen = event.notification.data?.url
	if (urlToOpen)
		event.waitUntil(
			self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
				// Check if a window is already open with the same URL.
				const existingClient = windowClients.find(client => {
					const clientUrl = new URL(client.url)
					const targetUrl = new URL(urlToOpen, self.location.origin)
					return clientUrl.pathname === targetUrl.pathname && clientUrl.search === targetUrl.search && clientUrl.hash === targetUrl.hash
				})

				if (existingClient)
					return existingClient.focus()
				else
					return self.clients.openWindow(urlToOpen)
			})
		)
})

/**
 * 拦截所有网络请求，并根据路由表进行处理。
 */
self.addEventListener('fetch', event => {
	const requestUrl = new URL(event.request.url)
	if (event.request.cache === 'no-cache') return handleNetworkFirst(event.request)
	if (event.request.cache === 'no-store') return
	for (const route of routes)
		if (route.condition({ event, request: event.request, url: requestUrl })) {
			const handlerResult = route.handler({ event, request: event.request, url: requestUrl })
			if (handlerResult) {
				event.respondWith(handlerResult)
				return // 找到匹配的处理器后，终止循环。
			}
			// 如果处理器返回 null，则跳过 Service Worker，让浏览器默认处理。
			return
		}
})
