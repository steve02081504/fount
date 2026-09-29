/**
 * 【文件】`dag/groupLock.mjs` — 单群 DAG 写路径互斥锁（可重入）。
 */
import { AsyncLocalStorage } from 'node:async_hooks'

import { compositeKey } from 'npm:@steve02081504/fount-p2p/core/composite_key'
import { withAsyncMutex } from 'npm:@steve02081504/fount-p2p/utils/async_mutex'

/**
 * 当前异步上下文持有的群写锁：锁键 -> 本次获取的唯一令牌。
 * @type {AsyncLocalStorage<Map<string, symbol>>}
 */
const heldGroupLocks = new AsyncLocalStorage()

/** 当前实际处于互斥临界区内的锁键 -> 持有它的令牌。 @type {Map<string, symbol>} */
const activeGroupLocks = new Map()

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
 *
 * 可重入判定要求「当前上下文继承的令牌」与「临界区当前令牌」一致；fire-and-forget 任务
 * 虽继承父上下文的持有标记，但令牌在父锁释放后即失效，其调用会重新排队取锁。
 * @template T
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {() => Promise<T>} fn 写操作
 * @returns {Promise<T>} `fn` 的解析结果
 */
export async function withGroupWriteLock(username, groupId, fn) {
	const key = groupLockKey(username, groupId)
	const held = heldGroupLocks.getStore()
	const heldToken = held?.get(key)
	if (heldToken && activeGroupLocks.get(key) === heldToken) return fn()

	return withAsyncMutex(`dag-write:${key}`, async () => {
		const token = Symbol(key)
		const parentHeld = held ?? new Map()
		const nextHeld = new Map(parentHeld)
		nextHeld.set(key, token)
		activeGroupLocks.set(key, token)
		try {
			return await heldGroupLocks.run(nextHeld, fn)
		}
		finally {
			if (activeGroupLocks.get(key) === token) activeGroupLocks.delete(key)
		}
	})
}

/**
 * 在「未持有任何群写锁」的异步上下文中执行 `fn`。
 *
 * 用于 fire-and-forget 任务（如自动回复生成）：它们由锁内代码启动，却可能在锁释放后才写盘；
 * 继承父上下文的持有标记会让其跳过互斥锁，此处显式脱离锁上下文，令其正常取锁。
 * @template T
 * @param {() => T} fn 待执行函数
 * @returns {T} `fn` 的返回值
 */
export function runOutsideGroupLocks(fn) {
	return heldGroupLocks.exit(fn)
}

/**
 * 判断当前异步上下文是否「声称」持有某群写锁、但已不在互斥临界区内（fire-and-forget 泄漏）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {boolean} 标记泄漏时为 true
 */
export function isGroupWriteLockLeaked(username, groupId) {
	const key = groupLockKey(username, groupId)
	const heldToken = heldGroupLocks.getStore()?.get(key)
	return !!heldToken && activeGroupLocks.get(key) !== heldToken
}
