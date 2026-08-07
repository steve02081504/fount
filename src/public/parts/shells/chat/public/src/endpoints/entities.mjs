/**
 * 【文件】public/src/endpoints/entities.mjs
 * 【职责】实体资料 REST：查询/更新/重建/EVFS 文件上传/主人绑定/网络搜索/心跳/在线状态。
 * 【原理】localeQueryString 仅附加 groupId（locales 由服务端从登录用户解析）；chatFetch 统一错误处理；uploadEntityFile 走 multipart（无 `json` 选项，body 为 FormData）。
 * 【数据结构】entityHash(128 hex)、groupId、profile JSON（localized 多语言）。
 * 【关联】entityProfileHoverCard、entityProfile、profileEdit、hubStatus、ownerSettingsPanel、friendsList；后端 entity/endpoints.mjs。
 */
import { chatFetch } from './groupClient.mjs'

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
 * 读取实体资料。
 * @param {string} entityHash 128 位 entityHash
 * @param {string} [groupId] 群 ID
 * @returns {Promise<{ profile: object }>} 资料 JSON
 */
export async function getEntityProfile(entityHash, groupId) {
	const queryString = localeQueryString(groupId)
	return chatFetch(`/entities/${encodeURIComponent(entityHash)}${queryString ? `?${queryString}` : ''}`)
}

/**
 * 更新实体资料。
 * @param {string} entityHash 128 位 entityHash
 * @param {object} updates 更新内容
 * @param {string} [groupId] 群 ID
 * @returns {Promise<object>} 更新后的资料 JSON（或代理写入时的 `{ queued: true, ... }`）
 */
export async function updateEntityProfile(entityHash, updates, groupId) {
	const queryString = localeQueryString(groupId)
	return chatFetch(`/entities/${encodeURIComponent(entityHash)}${queryString ? `?${queryString}` : ''}`, {
		method: 'PUT',
		json: { ...updates, ...groupId ? { groupId } : {} },
	})
}

/**
 * 从关联的角色 part 重建本地 agent 资料。
 * @param {string} entityHash 128 位 entityHash
 * @param {string} [groupId] 群 ID
 * @returns {Promise<{ profile: object }>} 重建后的资料 JSON
 */
export async function rebuildProfileFromPart(entityHash, groupId) {
	const qs = localeQueryString(groupId)
	return chatFetch(`/entities/${encodeURIComponent(entityHash)}/rebuild-from-part${qs ? `?${qs}` : ''}`, {
		method: 'POST',
	})
}

/**
 * multipart 写任意实体 EVFS 路径。
 * @param {string} entityHash 128 hex
 * @param {string} logicalPath EVFS 逻辑路径
 * @param {File|Blob} file 文件
 * @returns {Promise<{ url: string, manifest?: object }>} 上传结果
 */
export async function uploadEntityFile(entityHash, logicalPath, file) {
	const formData = new FormData()
	formData.append('file', file)
	const path = String(logicalPath || '').replace(/^\/+/, '')
	return chatFetch(`/entities/${encodeURIComponent(entityHash)}/files/${path}`, {
		method: 'POST',
		body: formData,
	})
}

/**
 * 为当前 operator 实体声明 / 清除 ownerEntityHash。
 * @param {string|null} ownerEntityHash 主人 128 hex；`null` 清除
 * @returns {Promise<{ entityHash: string, ownerEntityHash: string|null }>} 更新后的绑定
 */
export function setEntityOwner(ownerEntityHash) {
	return chatFetch('/entities/owner', { method: 'PUT', json: { ownerEntityHash } })
}

/**
 * 网络实体搜索（handle / 展示名）。
 * @param {string} query 查询词
 * @param {{ limit?: number }} [options] 选项
 * @returns {Promise<{ entities: object[] }>} 命中列表
 */
export function searchEntities(query, options = {}) {
	const params = new URLSearchParams({ q: query })
	if (options.limit) params.set('limit', String(options.limit))
	return chatFetch(`/entities/search?${params}`)
}

/**
 * 发送在线心跳。
 * @param {string} entityHash 128 位 entityHash
 * @returns {Promise<{ lastSeenAt: number, effectiveStatus: string }>} 心跳结果
 */
export function postEntityHeartbeat(entityHash) {
	return chatFetch(`/entities/${encodeURIComponent(entityHash)}/heartbeat`, { method: 'POST' })
}

/**
 * 设置在线状态（online / idle / dnd / invisible）与自定义状态文案。
 * @param {string} entityHash 128 位 entityHash
 * @param {string} status 状态键
 * @param {string} [customStatus] 自定义状态文案
 * @returns {Promise<{ status: string, customStatus: string, lastSeenAt: number, effectiveStatus: string }>} 更新后的状态
 */
export function setEntityStatus(entityHash, status, customStatus) {
	return chatFetch(`/entities/${encodeURIComponent(entityHash)}/status`, {
		method: 'POST',
		json: { status, customStatus },
	})
}

/**
 * 将 API profile 转为 Hub 缓存结构。
 * @param {object|null|undefined} profile API profile
 * @param {string} entityHash 128 位 entityHash
 * @returns {object|null} Hub 缓存结构或 `null`
 */
export function cachedProfileFromApi(profile, entityHash) {
	if (!profile) return null
	const key = String(entityHash || '').toLowerCase()
	return {
		entityHash: key,
		avatar: profile.avatar || null,
		infoDefaults: profile.infoDefaults || null,
		name: profile.name || key.slice(64, 72),
		handle: profile.handle || null,
		themeColor: profile.themeColor || '',
		banner: profile.displayBanner || profile.banner || '',
		sfw_banner: profile.sfw_banner || '',
		displayBanner: profile.displayBanner || profile.banner || '',
		description: profile.description || '',
		description_markdown: profile.description_markdown || '',
		localized: profile.localized || {},
		tags: Array.isArray(profile.tags) ? profile.tags : [],
		links: Array.isArray(profile.links) ? profile.links : [],
		status: profile.effectiveStatus || profile.status || 'offline',
		customStatus: profile.customStatus || '',
		ownerEntityHash: profile.ownerEntityHash
			? String(profile.ownerEntityHash).toLowerCase()
			: null,
		activePubKeyHex: profile.activePubKeyHex || null,
		keyGeneration: profile.keyGeneration ?? null,
	}
}
