import { randomBytes } from 'node:crypto'

/** @type {Map<string, { folder_key: Buffer, cabinet_id: string, folder_id: string, entity_hash: string, expires_at: number }>} */
const tokens = new Map()

const TTL_MS = 15 * 60 * 1000

/**
 * @returns {void}
 */
function gc() {
	const now = Date.now()
	for (const [token, row] of tokens)
		if (row.expires_at <= now) tokens.delete(token)
}

/**
 * @param {{ folder_key: Buffer, cabinet_id: string, folder_id: string, entity_hash: string }} payload 载荷
 * @returns {string} unlock token
 */
export function issueUnlockToken(payload) {
	gc()
	const token = randomBytes(24).toString('base64url')
	tokens.set(token, {
		...payload,
		expires_at: Date.now() + TTL_MS,
	})
	return token
}

/**
 * @param {string} token token
 * @returns {{ folder_key: Buffer, cabinet_id: string, folder_id: string, entity_hash: string, expires_at: number } | null} 载荷
 */
export function peekUnlockToken(token) {
	gc()
	const row = tokens.get(String(token || ''))
	if (!row || row.expires_at <= Date.now()) return null
	return row
}

/**
 * @param {string} token token
 * @param {{ cabinet_id: string, folder_id: string, entity_hash: string }} expect 期望上下文
 * @returns {Buffer | null} folder key
 */
export function resolveUnlockToken(token, expect) {
	gc()
	const row = tokens.get(String(token || ''))
	if (!row) return null
	if (row.cabinet_id !== expect.cabinet_id) return null
	if (row.folder_id !== expect.folder_id) return null
	if (row.entity_hash !== expect.entity_hash) return null
	row.expires_at = Date.now() + TTL_MS
	return row.folder_key
}

/**
 * 测试用：清空全部 token。
 * @returns {void}
 */
export function clearUnlockTokensForTests() {
	tokens.clear()
}
