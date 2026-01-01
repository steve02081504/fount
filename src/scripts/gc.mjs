import process from 'node:process'
/**
 * 触发一次垃圾回收。
 * @returns {void}
 */
export function gc() {
	if (!globalThis.gc) return console.warn('Garbage collection is not exposed. Skipping GC.')
	globalThis.gc({
		execution: 'sync',
		flavor: 'last-resort',
		type: 'major'
	})
}
/**
 * 在垃圾回收后获取当前内存使用情况。
 * @returns {number} 当前内存使用量（以字节为单位）。
 */
export function getMemoryUsage() {
	gc()
	return process.memoryUsage().heapUsed
}
