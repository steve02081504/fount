/**
 * 聊天列表操作的端点。
 */

/**
 * 获取聊天列表。
 * @returns {Promise<Array<string>>} 一个解析为聊天 ID 数组的 Promise。
 */
export async function getChatList() {
	const response = await fetch('/api/shells/chat/getchatlist')
	if (response.ok)
		return response.json()
	else {
		console.error('Failed to get chat list:', response.status, response.statusText)
		return []
	}
}

import { getCharDetails as getCharDetails_real } from '../../../../scripts/parts.mjs'

const char_details_cache = {}

/**
 * 获取角色详细信息。
 * @param {string} charname 角色的名称。
 * @returns {Promise<Object>} 一个解析为角色详细信息的 Promise。
 */
export async function getCharDetails(charname) {
	if (char_details_cache[charname])
		return char_details_cache[charname]


	const promise = getCharDetails_real(charname)
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
	const response = await fetch('/api/shells/chat/copy', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatids }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return response.json()
}

/**
 * 导入聊天。
 * @param {object} chatData 要导入的聊天数据。
 * @returns {Promise<object>} 解析为服务器响应的 Promise。
 * @throws {Error} 如果 API 请求失败。
 */
export async function importChat(chatData) {
	const response = await fetch('/api/shells/chat/import', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(chatData),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return response.json()
}

/**
 * 删除聊天。
 * @param {Array<string>} chatids 要删除的聊天 ID 数组。
 * @returns {Promise<Object>} 一个解析为服务器响应的 Promise。
 * @throws {Error} 如果 API 请求失败。
 */
export async function deleteChats(chatids) {
	const response = await fetch('/api/shells/chat/delete', {
		method: 'DELETE',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatids }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return response.json()
}

/**
 * 导出聊天。
 * @param {Array<string>} chatids 要导出的聊天 ID 数组。
 * @returns {Promise<Object>} 一个解析为服务器响应的 Promise。
 * @throws {Error} 如果 API 请求失败。
 */
export async function exportChats(chatids) {
	const response = await fetch('/api/shells/chat/export', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatids }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return response.json()
}
