/**
 * 【文件】lib/inviteTickets.mjs
 * 【职责】群邀请码 HMAC 签发与校验：短时 ticket 供 joinPolicy invite 模式与 fount://run join URI 使用。
 * 【原理】mintGroupInviteTicket 用 invite_hmac.key 生成 `expiresBase36.nonce.sig`。邀请码只有签发节点
 *   （持有该群 invite_hmac.key）能校验，因此 verify 发生在 owner 联邦入站的一次性鉴权处（validateJoinPolicy），
 *   replay 安全；非签发节点（中继/普通成员）拿不到密钥，返回 'unverifiable' 即放行，避免可构陷的误拒。
 * 【数据结构】code 字符串；invite_hmac.key 32 字节。
 * 【关联】governance/joinPolicy.mjs、public/src/lib/runUri parseJoinRunUri、HTTP 入群路由。
 */
import { Buffer } from 'node:buffer'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { groupDir } from './paths.mjs'

const DEFAULT_TTL_MS = 60 * 60 * 1000

/** @typedef {'valid' | 'invalid' | 'unverifiable'} InviteVerdict */

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {string} HMAC 密钥文件路径
 */
function inviteSecretPath(username, groupId) {
	return join(groupDir(username, groupId), 'invite_hmac.key')
}

/**
 * 读取本群 invite HMAC 密钥；不存在则返回 null（仅签发者持有，不在校验路径上创建）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<Buffer | null>} 32 字节密钥或 null
 */
async function loadInviteSecret(username, groupId) {
	try {
		const raw = await readFile(inviteSecretPath(username, groupId))
		return raw.byteLength >= 32 ? raw.subarray(0, 32) : null
	}
	catch {
		return null
	}
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
 * 签发短时群邀请码（仅签发节点可校验；跨节点入群仍走 DAG `peer_invite`）。
 * @param {string} username 签发者账户
 * @param {string} groupId 群 ID
 * @param {{ ttlMs?: number }} [options] 选项
 * @returns {Promise<{ code: string, expiresAt: number }>} 邀请码与过期时间
 */
export async function mintGroupInviteTicket(username, groupId, options = {}) {
	const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : DEFAULT_TTL_MS
	const expiresAt = Date.now() + ttlMs
	const nonce = randomBytes(8).toString('hex')
	const path = inviteSecretPath(username, groupId)
	let key = await loadInviteSecret(username, groupId)
	if (!key) {
		key = randomBytes(32)
		await mkdir(dirname(path), { recursive: true })
		await writeFile(path, key)
	}
	return { code: `${expiresAt.toString(36)}.${nonce}.${signInvite(key, groupId, expiresAt, nonce)}`, expiresAt }
}

/**
 * 校验邀请码。仅当本节点是签发者（持有该群 invite_hmac.key）时才下 'valid'/'invalid' 结论；
 * 否则返回 'unverifiable' 由调用方按存在性放行。
 * @param {string} username 群数据所有者
 * @param {string} groupId 群 ID
 * @param {string} code 邀请码
 * @returns {Promise<InviteVerdict>} 校验结论
 */
export async function verifyGroupInviteTicket(username, groupId, code) {
	const key = await loadInviteSecret(username, groupId)
	if (!key) return 'unverifiable'

	const [expiresPart, nonce, inviteSignatureHex] = String(code || '').trim().split('.')
	if (!expiresPart || !nonce || !inviteSignatureHex) return 'invalid'
	const expiresAt = Number.parseInt(expiresPart, 36)
	if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return 'invalid'

	const actual = Buffer.from(inviteSignatureHex, 'hex')
	const expected = Buffer.from(signInvite(key, groupId, expiresAt, nonce), 'hex')
	return actual.length === expected.length && timingSafeEqual(actual, expected) ? 'valid' : 'invalid'
}
