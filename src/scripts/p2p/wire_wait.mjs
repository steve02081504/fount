/**
 * Trystero 请求-响应等待表（gossip、channel history 等共用）。
 */

/**
 * @typedef {{ resolve: (value?: unknown) => void, timer: ReturnType<typeof setTimeout> }} WireWaiter
 */

/**
 * @param {Map<string, unknown>} pending 等待表
 * @param {string} key 等待键
 * @param {number} timeoutMs 超时毫秒
 * @param {() => unknown} onTimeout 超时回调值
 * @returns {{ resolve: (value: unknown) => void, promise: Promise<unknown> }} 等待句柄
 */
export function registerWireWait(pending, key, timeoutMs, onTimeout) {
	const waitPromise = new Promise(resolve => {
		const timer = setTimeout(() => {
			pending.delete(key)
			resolve(onTimeout())
		}, timeoutMs)
		pending.set(key, {
			/** @param {unknown} value 应答值 */
			resolve: value => {
				clearTimeout(timer)
				pending.delete(key)
				resolve(value)
			},
			timer,
		})
	})
	const entry = pending.get(key)
	return {
		resolve: entry.resolve,
		promise: waitPromise,
	}
}

/**
 * @param {Map<string, Map<string, WireWaiter[]>>} pending 按前缀分桶的多 waiter 表
 * @param {string} keyPrefix 键前缀（如 `user\0group\0`）
 * @param {string} suffixKey 后缀键
 * @returns {Map<string, WireWaiter[]>} 后缀桶
 */
function ensurePrefixBucket(pending, keyPrefix, suffixKey) {
	let bucket = pending.get(keyPrefix)
	if (!bucket) {
		bucket = new Map()
		pending.set(keyPrefix, bucket)
	}
	return bucket
}

/**
 * 多 waiter 注册（gossip 等同键并发等待）。
 * @param {Map<string, Map<string, WireWaiter[]>>} pending 多 waiter 表
 * @param {string} keyPrefix 键前缀
 * @param {string} suffixKey 后缀键
 * @param {number} timeoutMs 超时毫秒
 * @param {() => unknown} [onTimeout] 超时返回值
 * @returns {Promise<unknown>} 完成 promise
 */
export function registerMultiWireWait(pending, keyPrefix, suffixKey, timeoutMs, onTimeout = () => undefined) {
	return new Promise(resolve => {
		const timer = setTimeout(() => {
			finishMultiWireWaiters(pending, keyPrefix, suffixKey)
			resolve(onTimeout())
		}, timeoutMs)
		const bucket = ensurePrefixBucket(pending, keyPrefix, suffixKey)
		let waiters = bucket.get(suffixKey)
		if (!waiters) {
			waiters = []
			bucket.set(suffixKey, waiters)
		}
		waiters.push({ resolve, timer })
	})
}

/**
 * @param {Map<string, Map<string, WireWaiter[]>>} pending 多 waiter 表
 * @param {string} keyPrefix 键前缀
 * @param {string} suffixKey 后缀键
 * @returns {void}
 */
export function finishMultiWireWaiters(pending, keyPrefix, suffixKey) {
	const bucket = pending.get(keyPrefix)
	const waiters = bucket?.get(suffixKey)
	if (!waiters?.length) return
	bucket.delete(suffixKey)
	if (!bucket.size) pending.delete(keyPrefix)
	for (const waiter of waiters) {
		clearTimeout(waiter.timer)
		waiter.resolve()
	}
}

/**
 * 前缀桶内按 want id 命中唤醒 waiter。
 * @param {Map<string, Map<string, WireWaiter[]>>} pending 多 waiter 表
 * @param {string} keyPrefix 键前缀
 * @param {ReadonlySet<string>} hitIds 命中 id 集合
 * @param {(suffixKey: string) => string[] | null} parseWantIds 从后缀键解析 want id 列表
 * @returns {void}
 */
export function notifyMultiWireWaitersByPrefix(pending, keyPrefix, hitIds, parseWantIds) {
	if (!hitIds.size) return
	const bucket = pending.get(keyPrefix)
	if (!bucket) return
	for (const [suffixKey, waiters] of bucket) {
		const wanted = parseWantIds(suffixKey)
		if (!wanted?.length) continue
		let hit = false
		for (const id of hitIds) 
			if (wanted.includes(id)) {
				hit = true
				break
			}
		
		if (!hit) continue
		bucket.delete(suffixKey)
		for (const waiter of waiters) {
			clearTimeout(waiter.timer)
			waiter.resolve()
		}
	}
	if (!bucket.size) pending.delete(keyPrefix)
}
