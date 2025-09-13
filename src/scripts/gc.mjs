import process from 'node:process'
export function gc() {
	if (!globalThis.gc) return console.warn('Garbage collection is not exposed. Skipping GC.')
	globalThis.gc({
		execution: 'sync',
		flavor: 'last-resort',
		type: 'major'
	})
}
export function getMemoryUsage() {
	gc()
	return process.memoryUsage().heapUsed
}
