/**
 * 用户级 trustedAuthors（settings/trustedAuthors.json），chat / social 共用。
 */
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import { loadData, saveData } from '../../../../../server/setting_loader.mjs'

const DATANAME = 'trustedAuthors'

/**
 * @param {string} username 用户名
 * @returns {string[]} pubKeyHash 列表（小写 64 hex）
 */
export function loadTrustedAuthorHashes(username) {
	const raw = loadData(username, DATANAME)
	const hashes = Array.isArray(raw?.hashes) ? raw.hashes : []
	return [...new Set(hashes.map(hash => String(hash).trim().toLowerCase()).filter(isHex64))]
}

/**
 * @param {string} username 用户名
 * @param {string[]} hashes pubKeyHash 列表
 * @returns {string[]} 规范化后写入的列表
 */
export function saveTrustedAuthorHashes(username, hashes) {
	const normalized = [...new Set(
		(Array.isArray(hashes) ? hashes : [])
			.map(hash => String(hash).trim().toLowerCase())
			.filter(isHex64),
	)]
	const store = loadData(username, DATANAME)
	store.hashes = normalized
	saveData(username, DATANAME)
	return normalized
}
