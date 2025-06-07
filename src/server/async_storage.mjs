import { AsyncLocalStorage } from 'node:async_hooks'

const AsyncLocalStorages = {}

export function registerAsyncLocalStorage(uid, AsyncLocalStorage) {
	AsyncLocalStorages[uid] = AsyncLocalStorage
}
export function getAsyncLocalStorages() {
	return Object.fromEntries(
		Object.entries(AsyncLocalStorages)
			.map(([uid, AsyncLocalStorage]) => [uid, AsyncLocalStorage?.getStore?.()])
			.filter(([uid, store]) => store)
	)
}
export function enterAsyncLocalStorages(values) {
	for (const [uid, store] of Object.entries(values))
		AsyncLocalStorages[uid]?.enterWith?.(store)
}
export function runAsyncLocalStorages(values, callback) {
	return new AsyncLocalStorage().run(values, async () => {
		enterAsyncLocalStorages(values)
		return await callback()
	})
}
