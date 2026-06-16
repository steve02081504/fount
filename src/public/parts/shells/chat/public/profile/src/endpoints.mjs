/**
 * 【文件】public/profile/src/endpoints.mjs
 * 【职责】实体资料 REST 薄封装：GET/PUT /entities/:entityHash 与头像 multipart 上传。
 * 【原理】localeQueryString 附加 groupId；credentials include；错误时附带 response 的 Error。
 * 【数据结构】entityHash(128 hex)、updates 对象、File 头像。
 * 【关联】entityProfileApi.mjs；profile/index.mjs、Hub 资料编辑。
 */
import { localeQueryString } from '../../src/entityProfileApi.mjs'

/**
 * 实体资料 API（128 位 entityHash）
 */

/**
 * @param {string} entityHash 128 位 entityHash
 * @param {string} [groupId] 群 ID
 * @returns {Promise<object>} 资料 JSON
 */
export async function getProfile(entityHash, groupId) {
	const qs = localeQueryString(groupId)
	const response = await fetch(
		`/api/p2p/entities/${encodeURIComponent(entityHash)}${qs ? `?${qs}` : ''}`,
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
 * @param {object} updates 更新内容
 * @param {string} [groupId] 群 ID
 * @returns {Promise<object>} 更新后的资料 JSON
 */
export async function updateProfile(entityHash, updates, groupId) {
	const qs = localeQueryString(groupId)
	const response = await fetch(`/api/p2p/entities/${encodeURIComponent(entityHash)}${qs ? `?${qs}` : ''}`, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			...updates,
			...groupId ? { groupId } : {},
		}),
	})
	if (!response.ok) {
		const data = await response.json().catch(() => ({}))
		throw Object.assign(new Error(data.error || response.statusText), data, { response })
	}
	return response.json()
}

/**
 * @param {string} entityHash 128 位 entityHash
 * @param {File} file 头像文件
 * @returns {Promise<object>} 上传结果 JSON
 */
export async function uploadAvatar(entityHash, file) {
	const formData = new FormData()
	formData.append('avatar', file)
	const response = await fetch(`/api/p2p/entities/${encodeURIComponent(entityHash)}/files/profile/avatar`, {
		method: 'POST',
		body: formData,
	})
	if (!response.ok) {
		const data = await response.json().catch(() => ({}))
		throw Object.assign(new Error(data.error || response.statusText), data, { response })
	}
	return response.json()
}
