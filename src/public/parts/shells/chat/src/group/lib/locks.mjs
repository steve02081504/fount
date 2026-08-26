/**
 * 【文件】group/lib/locks.mjs
 * 【职责】同键并发临界区串行化工具：同一 map+key 下的临界区排队执行，完成后自动从 map 清理锁。
 * 【原理】以"在途 promise"为锁，后到者 await 前序；前序失败也放行本次。清理在临界区 IIFE 的
 *   finally 中按「锁表仍指向本次 run」判断，避免覆盖后到者刚写入的新锁。
 * 【关联】group/routes/channelAutoName.mjs（分类 find-or-create）、group/routes/governance.mjs（roomSecret 轮换）。
 */

/**
 * 串行执行 map+key 下的临界区。
 * @template T
 * @param {Map<string, Promise<T>>} locks 锁表（键 → 在途临界区 promise）
 * @param {string} key 锁键
 * @param {() => Promise<T>} critical 临界区（前序失败也继续执行本次）
 * @returns {Promise<T>} 临界区结果
 */
export function withLock(locks, key, critical) {
	const previous = locks.get(key) ?? Promise.resolve()
	const run = (async () => {
		try {
			try { await previous } catch { /* 前序失败也继续执行本次临界区 */ }
			return await critical()
		}
		finally {
			if (locks.get(key) === run) locks.delete(key)
		}
	})()
	locks.set(key, run)
	return run
}
