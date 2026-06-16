/**
 * 【文件】public/list/endpoints.mjs
 * 【职责】聊天历史列表页的 REST 客户端：会话列表、角色详情、批量复制/导出/删除/导入。
 * 【原理】对 /api/parts/shells:chat/sessions 与 /groups/:id/* 发起 fetch（credentials: include），失败时返回空数组或带 error 字段的结果对象。
 * 【数据结构】getGroupSessionList → 会话摘要[]；copyGroupSessions/exportGroupSessions/deleteGroupSessions → 按 groupId 的结果条目。
 * 【关联】list/index.mjs；后端 chat sessions 路由。
 */
/**
 * @returns {Promise<Array<object>>} 会话摘要列表
 */
export async function getGroupSessionList() {
	const response = await fetch('/api/parts/shells:chat/sessions/list', { credentials: 'include' })
	if (!response.ok) return []
	return response.json()
}

/**
 * @param {string} charname 角色部件名
 * @returns {Promise<object>} 角色详情
 */
export async function getCharDetails(charname) {
	const response = await fetch(`/api/getdetails/chars/${encodeURIComponent(charname)}`, { credentials: 'include' })
	if (!response.ok) throw new Error(`Failed to load char ${charname}`)
	return response.json()
}

/**
 * @param {string[]} groupIds 待复制的群组 ID
 * @returns {Promise<Array<{ groupId: string, newGroupId?: string, error?: string }>>} 各条复制结果
 */
export async function copyGroupSessions(groupIds) {
	return Promise.all(groupIds.map(async groupId => {
		const response = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/copy`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
		})
		if (!response.ok) {
			const data = await response.json().catch(() => ({}))
			return { groupId, error: data.error || response.statusText }
		}
		const data = await response.json()
		return { groupId, newGroupId: data.newGroupId }
	}))
}

/**
 * @param {object} chatData v2 导出 JSON
 * @returns {Promise<object>} 导入结果
 */
export async function importGroupSession(chatData) {
	const response = await fetch('/api/parts/shells:chat/groups/import', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(chatData),
	})
	if (!response.ok) {
		const data = await response.json().catch(() => ({}))
		throw Object.assign(new Error(data.error || `HTTP ${response.status}`), data, { response })
	}
	return response.json()
}

/**
 * @param {string[]} groupIds 待删除的群组 ID
 * @returns {Promise<Array<{ groupId: string, error?: string }>>} 各条删除结果
 */
export async function deleteGroupSessions(groupIds) {
	return Promise.all(groupIds.map(async groupId => {
		const response = await fetch(`/api/parts/shells:chat/sessions/${encodeURIComponent(groupId)}`, {
			method: 'DELETE',
			credentials: 'include',
		})
		if (!response.ok) {
			const data = await response.json().catch(() => ({}))
			return { groupId, error: data.error || response.statusText }
		}
		return { groupId }
	}))
}

/**
 * @param {string} groupId 群组 ID
 * @returns {Promise<object>} v2 导出数据
 */
export async function exportGroupSession(groupId) {
	const response = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/export`, {
		credentials: 'include',
	})
	if (!response.ok) {
		const data = await response.json().catch(() => ({}))
		throw Object.assign(new Error(data.error || `HTTP ${response.status}`), data, { response })
	}
	return response.json()
}

/**
 * @param {string[]} groupIds 待导出的群组 ID
 * @returns {Promise<Array<{ groupId: string, data?: object, error?: string }>>} 各条导出结果
 */
export async function exportGroupSessions(groupIds) {
	return Promise.all(groupIds.map(async groupId => {
		try {
			const data = await exportGroupSession(groupId)
			return { groupId, data }
		}
		catch (error) {
			return { groupId, error: error.message }
		}
	}))
}
