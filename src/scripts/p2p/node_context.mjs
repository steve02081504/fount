import { getLocalNodeHash } from './entity/replica.mjs'

/**
 * @param {string} username replica 登录名
 * @returns {string} 本节点 64 hex nodeHash
 */
export function getNodeHash(username) {
	return getLocalNodeHash(username)
}

/**
 * @param {string} username replica 登录名
 * @returns {string} 本节点 64 hex nodeHash
 */
export function requireNodeHash(username) {
	const nodeHash = getNodeHash(username)
	if (!nodeHash) throw new Error('p2p: nodeHash unavailable')
	return nodeHash
}
