/**
 * 【文件】public/src/entityProfileApi.mjs
 * 【职责】实体资料 API 辅助：locale 查询串、缓存规范化、fetchEntityProfileApi。
 * 【原理】localeQueryString 仅附加 groupId（locales 由服务端从登录用户解析）；cachedProfileFromApi 合并展示字段。
 * 【数据结构】entityHash(128)、groupId、profile JSON（localized 多语言）。
 * 【关联】profile/src/endpoints.mjs；Hub entityProfile。
 */
/**
 * 实体资料 API 查询串。不传 `locales`：服务端 `localesFromRequest` 用登录用户的 `user.locales`。
 * @param {string} [groupId] 群 ID（persona 解析）
 * @returns {string} 查询串
 */
export function localeQueryString(groupId) {
	const params = new URLSearchParams()
	if (groupId) params.set('groupId', groupId)
	return params.toString()
}

/**
 * 将 API profile 转为 Hub 缓存结构。
 * @param {object|null|undefined} profile API profile
 * @param {string} entityHash 128 位 entityHash
 * @returns {object|null} Hub 缓存结构或 null
 */
export function cachedProfileFromApi(profile, entityHash) {
	if (!profile) return null
	const key = String(entityHash || '').toLowerCase()
	return {
		avatar: profile.avatar || null,
		name: profile.name || key.slice(64, 72),
		themeColor: profile.themeColor || '',
		description: profile.description || '',
		description_markdown: profile.description_markdown || '',
		tags: Array.isArray(profile.tags) ? profile.tags : [],
		links: Array.isArray(profile.links) ? profile.links : [],
		status: profile.effectiveStatus || profile.status || 'offline',
		customStatus: profile.customStatus || '',
	}
}

/**
 * @param {string} entityHash 128 位 entityHash
 * @param {string} [groupId] 群 ID
 * @returns {Promise<object>} API JSON
 */
export async function fetchEntityProfileApi(entityHash, groupId) {
	const qs = localeQueryString(groupId)
	const response = await fetch(
		`/api/parts/shells:chat/entities/${encodeURIComponent(entityHash)}${qs ? `?${qs}` : ''}`,
		{ credentials: 'include' },
	)
	if (!response.ok) {
		const data = await response.json().catch(() => ({}))
		throw Object.assign(new Error(data.error || response.statusText), data, { response })
	}
	return response.json()
}

/**
 * @param {string} entityHash 128 位 entityHash
 * @param {object} updates 更新体
 * @param {string} [groupId] 群 ID
 * @returns {Promise<object>} API JSON
 */
export async function updateEntityProfileApi(entityHash, updates, groupId) {
	const qs = localeQueryString(groupId)
	const response = await fetch(
		`/api/parts/shells:chat/entities/${encodeURIComponent(entityHash)}${qs ? `?${qs}` : ''}`,
		{
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				...updates,
				...groupId ? { groupId } : {},
			}),
		},
	)
	if (!response.ok) {
		const data = await response.json().catch(() => ({}))
		throw Object.assign(new Error(data.error || response.statusText), data, { response })
	}
	return response.json()
}
