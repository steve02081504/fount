/**
 * 聊天列表操作的端点。
 */

/**
 * 获取聊天列表。
 * @returns {Promise<Array<string>>} 一个解析为聊天 ID 数组的 Promise。
 */
export async function getChatList() {
	const response = await fetch('/api/parts/shells:chat/getchatlist')
	if (response.ok)
		return response.json()
	else {
		console.error('Failed to get chat list:', response.status, response.statusText)
		return []
	}
}

/**
 * 列出本账户下的所有聊天/群组（含名称）。
 * @returns {Promise<{ groupIds: string[], groups: Array<{id: string, name: string}> }>} 群组 ID 列表与带名称的群组信息
 */
export async function getGroupList() {
	const response = await fetch('/api/parts/shells:chat/list')
	if (!response.ok)
		return { groupIds: [], groups: [] }
	const data = await response.json()
	if (!data.groups)
		data.groups = (data.groupIds || []).map(id => ({ id, name: id }))
	return data
}

/**
 * 创建私聊房间（随机 groupId）。
 * @returns {Promise<{ groupId?: string }>} 新建私聊的 groupId（失败时为空对象）
 */
export async function createDmRoom() {
	const response = await fetch('/api/parts/shells:chat/dm', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
	})
	if (!response.ok)
		return {}
	return response.json()
}

/**
 * 本地群组文件夹（shellData/chat/groupFolders.json）
 * @returns {Promise<{ folders: Array<{ id: string, name: string, color?: string, chatIds: string[] }> }>} 文件夹列表结构
 */
export async function getGroupFolders() {
	const response = await fetch('/api/parts/shells:chat/groupFolders')
	if (!response.ok)
		return { folders: [] }
	return response.json()
}

/**
 * 保存本地群组文件夹配置。
 * @param {{ folders: object[] }} body 包含 folders 数组的请求体
 * @returns {Promise<boolean>} 是否保存成功（HTTP 2xx）
 */
export async function saveGroupFolders(body) {
	const response = await fetch('/api/parts/shells:chat/groupFolders', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	return response.ok
}

import { getPartDetails } from '../../../../../scripts/parts.mjs'

const char_details_cache = {}

/**
 * 获取角色详细信息。
 * @param {string} charname 角色的名称。
 * @returns {Promise<Object>} 一个解析为角色详细信息的 Promise。
 */
export async function getCharDetails(charname) {
	if (char_details_cache[charname])
		return char_details_cache[charname]


	const promise = getPartDetails(`chars/${charname}`)
		.catch(error => {
			console.error('Error fetching char details:', error)
			delete char_details_cache[charname]
			throw error // Re-throw the error to propagate it.
		})

	char_details_cache[charname] = promise
	return promise
}

/**
 * 复制聊天。
 * @param {Array<string>} chatids 要复制的聊天 ID 数组。
 * @returns {Promise<Object>} 一个解析为服务器响应的 Promise。
 * @throws {Error} 如果 API 请求失败。
 */
export async function copyChats(chatids) {
	const response = await fetch('/api/parts/shells:chat/copy', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatids }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(e => {
			if (!(e instanceof SyntaxError)) throw e
			return {}
		}), { response })

	return response.json()
}

/**
 * 导入聊天。
 * @param {object} chatData 要导入的聊天数据。
 * @returns {Promise<object>} 解析为服务器响应的 Promise。
 * @throws {Error} 如果 API 请求失败。
 */
export async function importChat(chatData) {
	const response = await fetch('/api/parts/shells:chat/import', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(chatData),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(e => {
			if (!(e instanceof SyntaxError)) throw e
			return {}
		}), { response })

	return response.json()
}

/**
 * 删除聊天。
 * @param {Array<string>} chatids 要删除的聊天 ID 数组。
 * @returns {Promise<Object>} 一个解析为服务器响应的 Promise。
 * @throws {Error} 如果 API 请求失败。
 */
export async function deleteChats(chatids) {
	const response = await fetch('/api/parts/shells:chat/delete', {
		method: 'DELETE',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatids }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(e => {
			if (!(e instanceof SyntaxError)) throw e
			return {}
		}), { response })

	return response.json()
}

/**
 * 导出聊天。
 * @param {Array<string>} chatids 要导出的聊天 ID 数组。
 * @returns {Promise<Object>} 一个解析为服务器响应的 Promise。
 * @throws {Error} 如果 API 请求失败。
 */
export async function exportChats(chatids) {
	const response = await fetch('/api/parts/shells:chat/export', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatids }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(e => {
			if (!(e instanceof SyntaxError)) throw e
			return {}
		}), { response })

	return response.json()
}
