import { CHAT_API_CLIENT_PREFIX } from './apiPaths.mjs'

const ALIASES_API = `${CHAT_API_CLIENT_PREFIX}/aliases`

/** @type {{ entities: Record<string, string>, groups: Record<string, string> } | null} */
let cache = null
let loadPromise = null

/**
 * @param {string} entityHash 实体 hash
 * @returns {string} 规范化 entity hash
 */
function normEntity(entityHash) {
	return String(entityHash || '').trim().toLowerCase()
}

/**
 * @param {object} doc 别名档
 * @returns {Promise<{ entities: Record<string, string>, groups: Record<string, string> }>} 写入后的别名档
 */
async function putAliases(doc) {
	const response = await fetch(ALIASES_API, {
		method: 'PUT',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(doc),
	})
	const data = await response.json()
	if (!response.ok) throw new Error(data.error || 'save aliases failed')
	return { entities: data.entities || {}, groups: data.groups || {} }
}

/**
 * 拉取整档别名并填充内存缓存（幂等，并发共享同一请求）。
 * @returns {Promise<{ entities: Record<string, string>, groups: Record<string, string> }>} 别名档
 */
export async function loadAliases() {
	if (cache) return cache
	loadPromise ??= (async () => {
		const response = await fetch(ALIASES_API, { credentials: 'include' })
		const data = await response.json()
		if (!response.ok) throw new Error(data.error || 'load aliases failed')
		cache = { entities: data.entities || {}, groups: data.groups || {} }
		return cache
	})()
	try {
		return await loadPromise
	}
	finally {
		loadPromise = null
	}
}

/**
 * 同步读实体别名（供 authorDisplayLabel 等热路径）；缓存未预热或未命中返回空串。
 * @param {string} entityHash 实体 hash
 * @returns {string} 实体别名；未命中为空串
 */
export function aliasForEntity(entityHash) {
	return cache?.entities[normEntity(entityHash)] || ''
}

/**
 * 同步读群别名；缓存未预热或未命中返回空串。
 * @param {string} groupId 群 ID
 * @returns {string} 群别名；未命中为空串
 */
export function aliasForGroup(groupId) {
	return cache?.groups[String(groupId || '')] || ''
}

/**
 * 别名反查 groupId（具名群深链用）；未命中返回空串。
 * @param {string} alias 别名
 * @returns {string} 匹配别名的群 ID；未命中为空串
 */
export function groupIdForAlias(alias) {
	const name = String(alias || '').trim()
	if (!name || !cache) return ''
	for (const [groupId, value] of Object.entries(cache.groups))
		if (value === name) return groupId
	return ''
}

/**
 * 设置或删除实体别名（name 为空串则删除），整档 PUT 并更新缓存。
 * @param {string} entityHash 实体 hash
 * @param {string} name 名称
 * @returns {Promise<void>} 无
 */
export async function setEntityAlias(entityHash, name) {
	const current = await loadAliases()
	const entities = { ...current.entities }
	const key = normEntity(entityHash)
	const value = String(name || '').trim()
	if (value) entities[key] = value
	else delete entities[key]
	cache = await putAliases({ entities, groups: current.groups })
}

/**
 * 设置或删除群别名（name 为空串则删除），整档 PUT 并更新缓存。
 * @param {string} groupId 群 ID
 * @param {string} name 名称
 * @returns {Promise<void>} 无
 */
export async function setGroupAlias(groupId, name) {
	const current = await loadAliases()
	const groups = { ...current.groups }
	const key = String(groupId || '')
	const value = String(name || '').trim()
	if (value) groups[key] = value
	else delete groups[key]
	cache = await putAliases({ entities: current.entities, groups })
}
