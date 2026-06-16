/**
 * 【文件】lib/inviteTickets.mjs
 * 【职责】群邀请码 HMAC 签发与消费：短时 ticket 供 joinPolicy invite 模式与 fount://run join URI 使用。
 * 【原理】mintGroupInviteTicket 用 invite_hmac.key 生成 expiresBase36.nonce.sig；consume 时 timingSafeEqual 校验并检查过期。密钥按用户+群存 groupDir。
 * 【数据结构】code 字符串；invite_hmac.key 32 字节；options 含 ttl。
 * 【关联】governance/joinPolicy.mjs、public/src/lib/runUri parseJoinRunUri、HTTP 入群路由。
 */
import { Buffer } from 'node:buffer'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { groupDir } from './paths.mjs'
import { safeReadJson } from './utils.mjs'

const DEFAULT_TTL_MS = 60 * 60 * 1000

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {string} HMAC 密钥文件路径
 */
function inviteSecretPath(username, groupId) {
	return join(groupDir(username, groupId), 'invite_hmac.key')
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<Buffer>} 32 字节 HMAC 密钥
 */
async function loadOrCreateInviteSecret(username, groupId) {
	const path = inviteSecretPath(username, groupId)
	try {
		const raw = await readFile(path)
		if (raw.byteLength >= 32) return raw.subarray(0, 32)
	}
	catch { /* 新建 */ }
	await mkdir(dirname(path), { recursive: true })
	const key = randomBytes(32)
	await writeFile(path, key)
	return key
}

/**
 * @param {Buffer} key HMAC 密钥
 * @param {string} groupId 群 ID
 * @param {number} expiresAt 过期时间戳（毫秒）
 * @param {string} nonce 随机片段
 * @returns {string} hex 签名
 */
function signInvite(key, groupId, expiresAt, nonce) {
	return createHmac('sha256', key).update(`${groupId}\0${expiresAt}\0${nonce}`, 'utf8').digest('hex')
}

/**
 * 签发短时群邀请码（本节点校验；跨节点入群仍走 DAG `peer_invite`）。
 * @param {string} username 签发者账户
 * @param {string} groupId 群 ID
 * @param {{ ttlMs?: number }} [options] 选项
 * @returns {Promise<{ code: string, expiresAt: number }>} 邀请码与过期时间
 */
export async function mintGroupInviteTicket(username, groupId, options = {}) {
	const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : DEFAULT_TTL_MS
	const expiresAt = Date.now() + ttlMs
	const nonce = randomBytes(8).toString('hex')
	const inviteSignatureHex = signInvite(await loadOrCreateInviteSecret(username, groupId), groupId, expiresAt, nonce)
	return { code: `${expiresAt.toString(36)}.${nonce}.${inviteSignatureHex}`, expiresAt }
}

/**
 * 校验并消费邀请码（一次性：成功后写入已用表）。
 * @param {string} username 群数据所有者（被加入群的本地副本用户）
 * @param {string} groupId 群 ID
 * @param {string} code 邀请码
 * @returns {Promise<boolean>} 是否有效
 */
export async function consumeGroupInviteTicket(username, groupId, code) {
	const raw = String(code || '').trim()
	if (!raw) return false
	const [expiresPart, nonce, inviteSignatureHex] = raw.split('.')
	if (!expiresPart || !nonce || !inviteSignatureHex) return false
	const expiresAt = Number.parseInt(expiresPart, 36)
	if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false

	const key = await loadOrCreateInviteSecret(username, groupId)
	const expectedSignatureHex = signInvite(key, groupId, expiresAt, nonce)
	const actual = Buffer.from(inviteSignatureHex, 'hex')
	const expected = Buffer.from(expectedSignatureHex, 'hex')
	if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false

	const usedPath = join(groupDir(username, groupId), 'invite_used.json')
	const used = await safeReadJson(usedPath, {})
	if (used[raw]) return false
	used[raw] = Date.now()
	await mkdir(dirname(usedPath), { recursive: true })
	await writeFile(usedPath, JSON.stringify(used, null, '\t'), 'utf8')
	return true
}
