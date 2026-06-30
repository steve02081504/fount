/**
 * 【文件】`dag/groupLock.mjs` — 单群 DAG 写路径互斥锁（可重入）。
 */
import { AsyncLocalStorage } from 'node:async_hooks'

import { compositeKey } from '../../../../../../../scripts/p2p/composite_key.mjs'
import { withAsyncMutex } from '../../../../../../../scripts/p2p/utils/async_mutex.mjs'

/** @type {AsyncLocalStorage<Set<string>>} 当前异步上下文中已持有的群写锁键 */
const heldGroupLocks = new AsyncLocalStorage()

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {string} 锁键
 */
function groupLockKey(username, groupId) {
	return compositeKey(username, groupId)
}

/**
 * 在群级写锁内执行 `fn`（同用户同群 DAG 持久化路径互斥；同上下文可重入）。
 * @template T
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {() => Promise<T>} fn 写操作
 * @returns {Promise<T>} `fn` 的解析结果
 */
export async function withGroupWriteLock(username, groupId, fn) {
	const key = groupLockKey(username, groupId)
	const held = heldGroupLocks.getStore()
	if (held?.has(key)) return fn()

	return withAsyncMutex(`dag-write:${key}`, async () => {
		const parentHeld = held ?? new Set()
		const nextHeld = new Set(parentHeld)
		nextHeld.add(key)
		return heldGroupLocks.run(nextHeld, fn)
	})
}
