/**
 * EVFS 文件 URL 辅助。
 * @param {string} entityHash 128 hex
 * @param {string} logicalPath EVFS 逻辑路径
 * @returns {string} HTTP URL
 */
export function entityFileUrl(entityHash, logicalPath) {
	const path = String(logicalPath || '').trim().replace(/^\/+/, '')
	return `/api/p2p/entities/${encodeURIComponent(entityHash)}/files/${path.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * profile 头像 EVFS 路径 URL。
 * @param {string} entityHash 128 hex
 * @returns {string} profile 头像 HTTP URL
 */
export function profileAvatarFileUrl(entityHash) {
	return entityFileUrl(entityHash, 'profile/avatar')
}
