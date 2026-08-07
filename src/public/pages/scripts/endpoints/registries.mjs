/**
 * @typedef {{ id: string, level: number, path: string }} RegistryEntry
 */

/** @type {Map<string, Promise<RegistryEntry[]>>} */
const registryFetchCache = new Map()

/**
 * 获取指定 name 的 registry 条目（path 已为前端 URL）。
 * @param {string} name - registry 名称。
 * @param {{ nocache?: boolean }} [options] - 可选项。
 * @returns {Promise<RegistryEntry[]>} registry 条目列表。
 */
export async function getRegistry(name, { nocache = false } = {}) {
	if (!nocache && registryFetchCache.has(name))
		return registryFetchCache.get(name)

	const fetchPromise = (async () => {
		const qs = nocache ? '?nocache=1' : ''
		const res = await fetch(`/api/registries/${encodeURIComponent(name)}${qs}`)
		if (!res.ok)
			throw new Error(`registry fetch failed: ${name} ${res.status}`)
		return res.json()
	})()

	if (!nocache) registryFetchCache.set(name, fetchPromise)
	return fetchPromise
}

/**
 * 动态 import registry 条目指向的模块。
 * @param {string} name - registry 名称。
 * @param {{ nocache?: boolean }} [options] - 可选项。
 * @returns {Promise<Array<{ entry: RegistryEntry, module: unknown }>>} 已加载的模块列表。
 */
export async function importRegistryModules(name, { nocache = false } = {}) {
	const entries = await getRegistry(name, { nocache })
	return (await Promise.all(entries.map(async entry => {
		try {
			const module = await import(entry.path)
			return { entry, module }
		}
		catch (error) {
			console.warn(`registry import failed ${name}/${entry.id}:`, error)
			return null
		}
	}))).filter(Boolean)
}
