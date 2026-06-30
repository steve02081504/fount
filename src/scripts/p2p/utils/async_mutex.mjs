/**
 * 进程内 per-key 异步互斥锁（队列式，避免 Promise 链堆积）。
 */

/** @type {Map<string, { locked: boolean, queue: Array<() => void> }>} */
const mutexes = new Map()

/**
 * @param {string} lockKey 锁键
 * @returns {{ locked: boolean, queue: Array<() => void> }} 互斥状态
 */
function mutexState(lockKey) {
	let state = mutexes.get(lockKey)
	if (!state) {
		state = { locked: false, queue: [] }
		mutexes.set(lockKey, state)
	}
	return state
}

/**
 * @param {string} lockKey 锁键
 * @param {{ locked: boolean, queue: Array<() => void> }} state 互斥状态
 * @returns {void}
 */
function releaseMutex(lockKey, state) {
	const next = state.queue.shift()
	if (next) setTimeout(next, 0)
	else {
		state.locked = false
		mutexes.delete(lockKey)
	}
}

/**
 * @param {string} key 锁键
 * @param {() => Promise<T>} fn 临界区
 * @returns {Promise<T>} `fn` 的解析结果
 * @template T
 */
export async function withAsyncMutex(key, fn) {
	const lockKey = String(key)
	const state = mutexState(lockKey)
	return new Promise((resolve, reject) => {
		/**
		 * @returns {void}
		 */
		const run = () => {
			Promise.resolve()
				.then(fn)
				.then(resolve, reject)
				.finally(() => releaseMutex(lockKey, state))
		}
		if (state.locked) state.queue.push(run)
		else {
			state.locked = true
			run()
		}
	})
}

/**
 * @param {string} keyPrefix 前缀
 * @returns {(key: string, fn: () => Promise<T>) => Promise<T>} 带前缀的 mutex 函数
 * @template T
 */
export function asyncMutexForPrefix(keyPrefix) {
	return (key, fn) => withAsyncMutex(`${keyPrefix}:${key}`, fn)
}
