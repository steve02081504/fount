import path from 'node:path'

import { getUserDictionary } from '../../server/auth.mjs'

import { assertSafeEvfsLogicalPath } from './evfs_logical_path.mjs'

/**
 *
 */
export { assertSafeEvfsLogicalPath } from './evfs_logical_path.mjs'

/**
 * @param {string} username 用户
 * @returns {string} `{userDict}/entities`
 */
export function userEntitiesRoot(username) {
	return path.join(getUserDictionary(username), 'entities')
}

/**
 * @param {string} username 托管 replica
 * @param {string} entityHash 128 hex
 * @returns {string} 实体目录
 */
export function entityDir(username, entityHash) {
	return path.join(userEntitiesRoot(username), String(entityHash).trim().toLowerCase())
}

/**
 * @param {string} username 托管 replica
 * @param {string} entityHash 128 hex
 * @returns {string} profile.json 路径
 */
export function entityProfilePath(username, entityHash) {
	return path.join(entityDir(username, entityHash), 'profile.json')
}

/**
 * @param {string} username 托管 replica
 * @param {string} entityHash 128 hex
 * @returns {string} avatars 目录
 */
export function entityAvatarsDir(username, entityHash) {
	return path.join(entityDir(username, entityHash), 'avatars')
}

/**
 * @param {string} username 托管 replica
 * @param {string} entityHash 128 hex
 * @returns {string} stickers/packs 目录
 */
export function entityStickerPacksDir(username, entityHash) {
	return path.join(entityDir(username, entityHash), 'stickers', 'packs')
}

/**
 * @param {string} username replica
 * @param {string} entityHash 128 hex
 * @returns {string} `{userDict}/entities/{entityHash}/files`
 */
export function entityFilesRoot(username, entityHash) {
	return path.join(entityDir(username, entityHash), 'files')
}

/**
 * @param {string} username replica
 * @param {string} entityHash 128 hex
 * @param {string} logicalPath EVFS 逻辑路径
 * @returns {string} manifest.json 绝对路径
 */
export function entityFilesManifestPath(username, entityHash, logicalPath) {
	const root = entityFilesRoot(username, entityHash)
	const safe = assertSafeEvfsLogicalPath(logicalPath)
	const resolved = path.resolve(root, `${safe}.manifest.json`)
	const rootResolved = path.resolve(root)
	if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep))
		throw new Error('invalid EVFS path traversal')
	return resolved
}

/**
 * @param {string} username replica
 * @returns {string} P2P mailbox store-and-forward JSONL
 */
export function mailboxStorePath(username) {
	return path.join(getUserDictionary(username), 'p2p', 'mailbox', 'store.jsonl')
}
