/**
 * 【文件】`dag/localSigner.mjs` — 本群本地 Ed25519 签名种子管理。
 * 【职责】读写 `local_signer.seed`；解析 HTTP/chatLog 写入用的 `sender`（pubKeyHash）与 `secretKey`。
 * 【原理】种子 32 字节不入 DAG；建群前仅 mkdir+生成密钥；已物化成员表时校验成员 `pubKeyHash` 与种子派生哈希一致，防止错绑身份。
 * 【数据结构】返回 `{ sender: string, secretKey: Uint8Array }`；`sender` 恒为 64 hex pubKeyHash。
 * 【关联】`append.mjs`、`channelOps.mjs`、`chatLogMirror.mjs`、`validator.mjs`。
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'

import { pubKeyHash, publicKeyFromSeed, randomKeyPair } from 'npm:@steve02081504/fount-p2p/crypto'
import { resolveActiveMemberKey } from '../../group/access.mjs'
import { groupDir, localSignerSeedPath } from '../lib/paths.mjs'

import { getState } from './materialize.mjs'
import { PUB_KEY_HASH_HEX } from './validator.mjs'

/**
 * 读取或创建本群本地签名种子（32 字节）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<Uint8Array>} 私钥种子
 */
export async function readLocalSignerSeed(username, groupId) {
	return ensureLocalSignerSeed(username, groupId)
}

/** 进程内 per-group 种子创建锁，串行化首次创建，杜绝 TOCTOU 竞态导致的身份漂移。 */
const seedCreationLocks = new Map()

/**
 * 实际的读取/创建逻辑：文件已存在则读出；否则原子创建（`wx`），跨进程竞争时回读胜出者。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<Uint8Array>} 私钥种子
 */
async function loadOrCreateLocalSignerSeed(username, groupId) {
	await mkdir(groupDir(username, groupId), { recursive: true })
	const path = localSignerSeedPath(username, groupId)
	try {
		await access(path)
		const raw = await readFile(path)
		if (raw.length >= 32) return new Uint8Array(raw.buffer, raw.byteOffset, 32)
	}
	catch { /* create below */ }
	const { secretKey } = await randomKeyPair()
	try {
		await writeFile(path, secretKey, { flag: 'wx' })
		return secretKey
	}
	catch {
		const raw = await readFile(path)
		if (raw.length >= 32) return new Uint8Array(raw.buffer, raw.byteOffset, 32)
		return secretKey
	}
}

/**
 * 读取或创建本群本地签名种子（32 字节，不入 DAG）。
 *
 * 入群时多条异步路径会同时首次请求种子；用进程内 promise 锁串行化，确保它们拿到同一个种子，
 * 避免 member_join 与后续 attestation 绑定到不同身份。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<Uint8Array>} 私钥种子
 */
async function ensureLocalSignerSeed(username, groupId) {
	const key = `${username}\u0000${groupId}`
	let pending = seedCreationLocks.get(key)
	if (!pending) {
		pending = loadOrCreateLocalSignerSeed(username, groupId)
			.finally(() => { seedCreationLocks.delete(key) })
		seedCreationLocks.set(key, pending)
	}
	return pending
}

/**
 * 建群前解析本地签名上下文（仅 mkdir + 种子，不物化、不 ensureGroup）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<{ sender: string, secretKey: Uint8Array }>} pubKeyHash 与签名密钥
 */
export async function getLocalSignerForNewGroup(username, groupId) {
	const secretKey = await ensureLocalSignerSeed(username, groupId)
	const sender = pubKeyHash(publicKeyFromSeed(secretKey))
	return { sender, secretKey }
}

/**
 * 解析本机 HTTP / chatLog 镜像写入用的签名上下文（sender 恒为 pubKeyHash）。
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @returns {Promise<{ sender: string, secretKey: Uint8Array }>} 发件人哈希与签名密钥
 */
export async function resolveLocalEventSigner(username, groupId) {
	const secretKey = await ensureLocalSignerSeed(username, groupId)
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
		return { sender: memberHash, secretKey }
	}

	return { sender: derivedHash, secretKey }
}
