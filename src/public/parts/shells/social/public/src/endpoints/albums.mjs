/** Social 相册。 */
import { socialRequest } from './client.mjs'

/**
 * operator 自身相册列表（发帖框相册选择器用）。
 * @returns {Promise<{ albums: object[] }>} 相册列表
 */
export function getOwnAlbums() {
	return socialRequest('/albums')
}

/**
 * @param {string} entityHash owner
 * @returns {Promise<{ albums: object[] }>} 相册列表
 */
export function getEntityAlbums(entityHash) {
	return socialRequest(`/albums/${encodeURIComponent(entityHash)}`)
}

/**
 * @param {string} entityHash owner
 * @param {string} albumId 相册 id
 * @returns {Promise<{ album: object, items: object[] }>} 相册详情
 */
export function getAlbumDetail(entityHash, albumId) {
	return socialRequest(`/albums/${encodeURIComponent(entityHash)}/${encodeURIComponent(albumId)}`)
}

/**
 * @param {object} body 相册 body（name / description / visibility …）
 * @returns {Promise<object>} 新建相册
 */
export function createAlbum(body) {
	return socialRequest('/albums', { method: 'POST', body: JSON.stringify(body) })
}

/**
 * @param {string} albumId 相册 id
 * @param {object} body 更新 body
 * @returns {Promise<object>} 写入结果
 */
export function updateAlbum(albumId, body) {
	return socialRequest(`/albums/${encodeURIComponent(albumId)}/update`, {
		method: 'POST',
		body: JSON.stringify(body),
	})
}

/**
 * @param {string} albumId 相册 id
 * @param {boolean} [deletePosts=false] 是否连带删除成员帖
 * @returns {Promise<object>} 写入结果
 */
export function deleteAlbum(albumId, deletePosts = false) {
	return socialRequest(`/albums/${encodeURIComponent(albumId)}?deletePosts=${deletePosts ? '1' : '0'}`, {
		method: 'DELETE',
	})
}
