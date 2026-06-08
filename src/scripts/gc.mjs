import process from 'node:process'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'

/**
 * 触发一次垃圾回收。
 * @returns {void}
 */
export function gc() {
	setFlagsFromString('--expose_gc')
	runInNewContext('gc')({
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
