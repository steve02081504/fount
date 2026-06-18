/**
 * @typedef {{ id: string, level: number, path: string }} RegistryEntry
 */

/** @type {Map<string, Promise<RegistryEntry[]>>} */
const registryFetchCache = new Map()

/**
 * 获取指定 name 的 registry 条目（path 已为前端 URL）。
 * @param {string} name - registry 名称。
 * @param {{ nocache?: boolean }} [options]
 * @returns {Promise<RegistryEntry[]>}
 */
export async function getRegistry(name, { nocache = false } = {}) {
	const key = nocache ? `${name}:nocache` : name
	if (!nocache && registryFetchCache.has(key))
		return registryFetchCache.get(key)

	const fetchPromise = (async () => {
		try {
			const qs = nocache ? '?nocache=1' : ''
			const res = await fetch(`/api/registries/${encodeURIComponent(name)}${qs}`)
			if (!res.ok) return []
			const data = await res.json()
			return Array.isArray(data) ? data : []
		}
		catch {
			return []
		}
	})()

	if (!nocache) registryFetchCache.set(key, fetchPromise)
	return fetchPromise
}

/**
 * 清除前端 registry fetch 缓存。
 * @param {string} [name] - 若指定则只清除该 name，否则清除全部。
 * @returns {void}
 */
export function invalidateRegistryCache(name) {
	if (name) {
		registryFetchCache.delete(name)
		registryFetchCache.delete(`${name}:nocache`)
		return
	}
	registryFetchCache.clear()
}

/**
 * 动态 import registry 条目指向的模块。
 * @param {string} name - registry 名称。
 * @param {{ nocache?: boolean }} [options]
 * @returns {Promise<Array<{ entry: RegistryEntry, module: unknown }>>}
 */
export async function importRegistryModules(name, { nocache = false } = {}) {
	const entries = await getRegistry(name, { nocache })
	const results = await Promise.all(entries.map(async entry => {
		try {
			const module = await import(entry.path)
			return { entry, module }
		}
		catch {
			return null
		}
	}))
	return results.filter(Boolean)
}

/**
 * fetch registry 条目指向的 JSON 数据文件。
 * @param {string} name - registry 名称。
 * @param {{ nocache?: boolean }} [options]
 * @returns {Promise<Array<{ entry: RegistryEntry, data: unknown }>>}
 */
export async function fetchRegistryJson(name, { nocache = false } = {}) {
	const entries = await getRegistry(name, { nocache })
	const results = await Promise.all(entries.map(async entry => {
		try {
			const res = await fetch(entry.path)
			if (!res.ok) return null
			const data = await res.json()
			return { entry, data }
		}
		catch {
			return null
		}
	}))
	return results.filter(Boolean)
}
