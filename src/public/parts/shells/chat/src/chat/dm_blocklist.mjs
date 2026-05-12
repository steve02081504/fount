import { loadShellData, saveShellData } from '../../../../../../server/setting_loader.mjs'

const PUB_KEY_HASH_HEX = /^[0-9a-f]{64}$/iu

/**
 * @param {unknown} hex 原始公钥哈希或带 `0x` 前缀的字符串
 * @returns {string} 小写十六进制公钥哈希
 */
function normalizePubKeyHashHex(hex) {
	return String(hex || '').trim().toLowerCase().replace(/^0x/iu, '')
}

/**
 * @param {unknown} raw 磁盘 JSON 或请求体
 * @returns {{ blocked: Array<{ pubKeyHash: string, groupId?: string }> }} 规范化后的拉黑表
 */
export function normalizeDmBlocklist(raw) {
	const o = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ raw : {}
	const blocked = []
	const arr = Array.isArray(o.blocked) ? o.blocked : []
	for (const e of arr) {
		if (typeof e === 'string') {
			const h = normalizePubKeyHashHex(e)
			if (PUB_KEY_HASH_HEX.test(h)) blocked.push({ pubKeyHash: h })
			continue
		}
		if (e && typeof e === 'object') {
			const h = normalizePubKeyHashHex(/** @type {{ pubKeyHash?: unknown }} */ e.pubKeyHash)
			if (!PUB_KEY_HASH_HEX.test(h)) continue
			const gid = typeof /** @type {{ groupId?: unknown }} */ e.groupId === 'string' ? e.groupId.trim() : undefined
			blocked.push({ pubKeyHash: h, ...gid ? { groupId: gid } : {} })
		}
	}
	return { blocked }
}

/**
 * 读取 DM / 联邦主体拉黑表（计划 §0.1 `blockedPeers` 等价物）。
 * @param {string} username 登录用户
 * @returns {{ blocked: Array<{ pubKeyHash: string, groupId?: string }> }} 规范化拉黑表
 */
export function loadDmBlocklist(username) {
	return normalizeDmBlocklist(loadShellData(username, 'chat', 'dm_blocklist'))
}

/**
 * 某 `pubKeyHash` 是否被当前用户全局拉黑。
 * @param {string} username 登录用户
 * @param {string} pubKeyHash 64 位十六进制公钥哈希
 * @returns {boolean} 已在拉黑表中时为 true
 */
export function isPubKeyHashBlocked(username, pubKeyHash) {
	const h = normalizePubKeyHashHex(pubKeyHash)
	if (!PUB_KEY_HASH_HEX.test(h)) return false
	return loadDmBlocklist(username).blocked.some(b => b.pubKeyHash === h)
}

/**
 * 追加拉黑并落盘。
 * @param {string} username 登录用户
 * @param {string} pubKeyHash 公钥哈希
 * @param {string} [groupId] 可选来源群
 * @returns {void}
 */
export function addDmBlock(username, pubKeyHash, groupId) {
	const h = normalizePubKeyHashHex(pubKeyHash)
	if (!PUB_KEY_HASH_HEX.test(h)) throw new Error('invalid pubKeyHash')
	const o = /** @type {{ blocked?: unknown }} */ loadShellData(username, 'chat', 'dm_blocklist')
	if (!Array.isArray(o.blocked)) o.blocked = []
	const arr = /** @type {Array<string | { pubKeyHash?: string }>} */ o.blocked
	const exists = arr.some(e => {
		if (typeof e === 'string') return normalizePubKeyHashHex(e) === h
		return e && typeof e === 'object' && normalizePubKeyHashHex(e.pubKeyHash) === h
	})
	if (!exists) {
		const row = groupId && typeof groupId === 'string' && groupId.trim()
			? { pubKeyHash: h, groupId: groupId.trim() }
			: { pubKeyHash: h }
		arr.push(row)
	}
	saveShellData(username, 'chat', 'dm_blocklist')
}
