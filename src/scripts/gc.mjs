import process from 'node:process'
export function gc() {
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
