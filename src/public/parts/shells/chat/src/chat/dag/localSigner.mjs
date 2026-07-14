/**
 * 【文件】`dag/localSigner.mjs` — 本群 per-entity Ed25519 签名种子管理。
 * 【职责】读写 `signers/{entityHash}/local_signer_seed`；解析写入用的 `sender`（pubKeyHash）与 `secretKey`。
 * 【原理】种子 32 字节不入 DAG；跨群不关联。旧群级 `local_signer_seed` 仅对 operator 实体迁移读并搬迁。
 * 【数据结构】返回 `{ sender: string, secretKey: Uint8Array }`；`sender` 恒为 64 hex pubKeyHash。
 * 【关联】`append.mjs`、`channelOps.mjs`、`chatLogMirror.mjs`、`validator.mjs`。
 */
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Buffer } from 'node:buffer'

import { pubKeyHash, publicKeyFromSeed, randomKeyPair } from 'npm:@steve02081504/fount-p2p/crypto'

import { resolveActiveMemberKey } from '../../group/access.mjs'
import { legacyLocalSignerSeedPath, localSignerSeedPath } from '../lib/paths.mjs'

import { getState } from './materialize.mjs'
import { PUB_KEY_HASH_HEX } from './validator.mjs'

/**
 * @param {string} username replica
 * @param {string} [entityHash] 缺省则解析 operator
 * @returns {Promise<string>} 小写 128-hex entityHash
 */
async function resolveSignerEntityHash(username, entityHash) {
	const declared = String(entityHash || '').trim().toLowerCase()
	if (declared) return declared
	const { resolveOperatorEntityHashForUser } = await import('../../entity/identity.mjs')
	const hash = await resolveOperatorEntityHashForUser(username)
	if (!hash) throw new Error('operator entityHash required for local signer')
	return hash
}

/**
 * 读取或创建本群实体签名种子（32 字节）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} [entityHash] 实体；缺省 operator
 * @returns {Promise<Uint8Array>} 私钥种子
 */
export async function readLocalSignerSeed(username, groupId, entityHash) {
	return ensureLocalSignerSeed(username, groupId, entityHash)
}

/** 进程内 per-(group,entity) 种子创建锁，串行化首次创建，杜绝 TOCTOU 竞态导致的身份漂移。 */
const seedCreationLocks = new Map()

/**
 * @param {Uint8Array | Buffer} raw 原始文件字节
 * @returns {Uint8Array | null} 有效 32 字节种子
 */
function seedFromRaw(raw) {
	if (raw.length < 32) return null
	return new Uint8Array(raw.buffer, raw.byteOffset, 32)
}

/**
 * 实际的读取/创建逻辑：新路径优先；operator 可从旧群级种子迁移。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} entityHash 128-hex
 * @returns {Promise<Uint8Array>} 私钥种子
 */
async function loadOrCreateLocalSignerSeed(username, groupId, entityHash) {
	const path = localSignerSeedPath(username, groupId, entityHash)
	await mkdir(dirname(path), { recursive: true })
	try {
		await access(path)
		const seed = seedFromRaw(await readFile(path))
		if (seed) return seed
	}
	catch { /* migrate or create below */ }

	const { resolveOperatorEntityHashForUser } = await import('../../entity/identity.mjs')
	const operatorHash = await resolveOperatorEntityHashForUser(username)
	if (operatorHash && entityHash === operatorHash) {
		const legacy = legacyLocalSignerSeedPath(username, groupId)
		try {
			const seed = seedFromRaw(await readFile(legacy))
			if (seed) {
				try {
					await writeFile(path, seed, { flag: 'wx' })
					await rename(legacy, `${legacy}.migrated`).catch(async () => {
						const { unlink } = await import('node:fs/promises')
						await unlink(legacy).catch(() => { /* best-effort */ })
					})
				}
				catch {
					const existing = seedFromRaw(await readFile(path).catch(() => Buffer.alloc(0)))
					if (existing) return existing
				}
				return seed
			}
		}
		catch { /* no legacy */ }
	}

	const { secretKey } = await randomKeyPair()
	try {
		await writeFile(path, secretKey, { flag: 'wx' })
		return secretKey
	}
	catch {
		const seed = seedFromRaw(await readFile(path).catch(() => Buffer.alloc(0)))
		if (seed) return seed
		return secretKey
	}
}

/**
 * 读取或创建本群实体签名种子（32 字节，不入 DAG）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} [entityHash] 实体；缺省 operator
 * @returns {Promise<Uint8Array>} 私钥种子
 */
async function ensureLocalSignerSeed(username, groupId, entityHash) {
	const resolved = await resolveSignerEntityHash(username, entityHash)
	const key = `${username}\u0000${groupId}\u0000${resolved}`
	let pending = seedCreationLocks.get(key)
	if (!pending) {
		pending = loadOrCreateLocalSignerSeed(username, groupId, resolved)
			.finally(() => { seedCreationLocks.delete(key) })
		seedCreationLocks.set(key, pending)
	}
	return pending
}

/**
 * 建群前解析本地签名上下文（仅 mkdir + 种子，不物化、不 ensureGroup）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} [entityHash] 实体；缺省 operator
 * @returns {Promise<{ sender: string, secretKey: Uint8Array }>} pubKeyHash 与签名密钥
 */
export async function getLocalSignerForNewGroup(username, groupId, entityHash) {
	const secretKey = await ensureLocalSignerSeed(username, groupId, entityHash)
	const sender = pubKeyHash(publicKeyFromSeed(secretKey))
	return { sender, secretKey }
}

/**
 * 解析本机 HTTP / chatLog 镜像写入用的签名上下文（sender 恒为 pubKeyHash）。
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {string} [entityHash] 实体；缺省 operator
 * @returns {Promise<{ sender: string, secretKey: Uint8Array, entityHash: string }>} 发件人哈希与签名密钥
 */
export async function resolveLocalEventSigner(username, groupId, entityHash) {
	const resolved = await resolveSignerEntityHash(username, entityHash)
	const secretKey = await ensureLocalSignerSeed(username, groupId, resolved)
	const derivedHash = pubKeyHash(publicKeyFromSeed(secretKey))

	const { state } = await getState(username, groupId)
	const memberKey = resolveActiveMemberKey(state, derivedHash)
	const member = memberKey ? state.members[memberKey] : null
	const memberHash = String(member?.pubKeyHash || '').trim().toLowerCase()

	if (PUB_KEY_HASH_HEX.test(memberHash)) {
		if (memberHash !== derivedHash)
			throw new Error(
				`localSigner mismatch: member pubKeyHash ${memberHash} ≠ local seed derivedHash ${derivedHash}. `
				+ 'Re-join the group or rotate the local seed.',
			)
		return { sender: memberHash, secretKey, entityHash: resolved }
	}

	return { sender: derivedHash, secretKey, entityHash: resolved }
}
