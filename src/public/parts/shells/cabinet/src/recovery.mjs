import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'

import { cabinetDir, sharedCabinetDir } from './paths.mjs'

const TTL_MS = 2 * 60 * 60 * 1000

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {boolean} shared 是否共享柜
 * @returns {string} recovery 目录
 */
function recoveryDir(username, entityHash, cabinetId, shared) {
	return shared
		? `${sharedCabinetDir(username, cabinetId)}/recovery`
		: `${cabinetDir(username, entityHash, cabinetId)}/recovery`
}

/**
 * @param {string} dir 目录
 * @param {string} token token
 * @returns {string} 文件路径
 */
function tokenPath(dir, token) {
	return `${dir}/${token}.json`
}

/**
 * @param {string} dir recovery 目录
 * @returns {Promise<void>}
 */
async function purgeExpiredInDir(dir) {
	let names
	try {
		names = await readdir(dir)
	}
	catch {
		return
	}
	const now = Date.now()
	await Promise.all(names.map(async name => {
		if (!name.endsWith('.json')) return
		const path = `${dir}/${name}`
		try {
			const raw = JSON.parse(await readFile(path, 'utf8'))
			if (Number(raw.expires_at) <= now) await unlink(path).catch(() => { })
		}
		catch {
			await unlink(path).catch(() => { })
		}
	}))
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {boolean} shared 是否共享柜
 * @returns {Promise<string>} recovery 目录
 */
async function ensureRecoveryDir(username, entityHash, cabinetId, shared) {
	const dir = recoveryDir(username, entityHash, cabinetId, shared)
	await mkdir(dir, { recursive: true })
	await purgeExpiredInDir(dir)
	return dir
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {{
 *   shared?: boolean,
 *   entries: object[],
 *   encrypted_indexes?: Record<string, string | object>,
 * }} payload 载荷
 * @returns {Promise<string>} recovery_token
 */
export async function storeRecovery(username, entityHash, cabinetId, payload) {
	const dir = await ensureRecoveryDir(username, entityHash, cabinetId, Boolean(payload.shared))
	const recovery_token = randomUUID()
	await writeFile(tokenPath(dir, recovery_token), JSON.stringify({
		recovery_token,
		cabinet_id: cabinetId,
		created_at: Date.now(),
		expires_at: Date.now() + TTL_MS,
		entries: payload.entries || [],
		encrypted_indexes: payload.encrypted_indexes || {},
	}), 'utf8')
	return recovery_token
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {string} recoveryToken token
 * @param {boolean} [shared] 共享柜
 * @returns {Promise<object | null>} 记录
 */
export async function loadRecovery(username, entityHash, cabinetId, recoveryToken, shared = false) {
	const dir = recoveryDir(username, entityHash, cabinetId, shared)
	await purgeExpiredInDir(dir)
	try {
		const raw = JSON.parse(await readFile(tokenPath(dir, recoveryToken), 'utf8'))
		if (raw.cabinet_id !== cabinetId) return null
		if (Number(raw.expires_at) <= Date.now()) {
			await unlink(tokenPath(dir, recoveryToken)).catch(() => { })
			return null
		}
		return raw
	}
	catch {
		return null
	}
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {string} cabinetId 柜
 * @param {string} recoveryToken token
 * @param {boolean} [shared] 共享柜
 * @returns {Promise<void>}
 */
export async function clearRecovery(username, entityHash, cabinetId, recoveryToken, shared = false) {
	await unlink(tokenPath(recoveryDir(username, entityHash, cabinetId, shared), recoveryToken)).catch(() => { })
}
