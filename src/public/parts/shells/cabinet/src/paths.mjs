import { getUserDictionary } from '../../../../../server/auth/index.mjs'

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @returns {string} 柜根目录
 */
export function cabinetEntityRoot(username, entityHash) {
	return `${getUserDictionary(username)}/shells/cabinet/entities/${entityHash}`
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @returns {string} cabinets.json 路径
 */
export function cabinetsListPath(username, entityHash) {
	return `${cabinetEntityRoot(username, entityHash)}/cabinets.json`
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜 id
 * @returns {string} 柜目录
 */
export function cabinetDir(username, entityHash, cabinetId) {
	return `${cabinetEntityRoot(username, entityHash)}/${cabinetId}`
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜 id
 * @returns {string} 索引路径
 */
export function cabinetIndexPath(username, entityHash, cabinetId) {
	return `${cabinetDir(username, entityHash, cabinetId)}/index.json`
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜 id
 * @param {string} folderId 文件夹 id
 * @returns {string} 加密子索引路径
 */
export function encryptedFolderIndexPath(username, entityHash, cabinetId, folderId) {
	return `${cabinetDir(username, entityHash, cabinetId)}/enc/${folderId}.json`
}

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜 id
 * @returns {string} 同步快照路径
 */
export function syncStatePath(username, cabinetId) {
	return `${getUserDictionary(username)}/shells/cabinet/sync_state/${cabinetId}.json`
}

/**
 * @param {string} cabinetId 柜 id
 * @returns {string} EVFS 柜索引逻辑路径
 */
export function evfsCabinetIndexPath(cabinetId) {
	return `shells/cabinet/${cabinetId}/index.json`
}

/**
 * @param {string} cabinetId 柜 id
 * @param {string} blobId blob id
 * @returns {string} EVFS blob 逻辑路径
 */
export function evfsBlobPath(cabinetId, blobId) {
	return `shells/cabinet/${cabinetId}/blobs/${blobId}`
}

/**
 * @param {string} cabinetId 柜 id
 * @param {string} previewId 预览 id
 * @returns {string} EVFS 预览逻辑路径
 */
export function evfsPreviewPath(cabinetId, previewId) {
	return `shells/cabinet/${cabinetId}/previews/${previewId}`
}
