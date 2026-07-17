import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { nextHlc } from 'npm:@steve02081504/fount-p2p/core/hlc'
import { randomKeyPair } from 'npm:@steve02081504/fount-p2p/crypto'

import { sharedCabinetKeysPath, sharedCabinetsRegistryPath } from '../paths.mjs'

import { writeIdentityFromSecret } from './crypto.mjs'

/**
 * @typedef {{
 *   write_privkey?: string,
 *   write_pubkey: string,
 *   read_keys: Array<{ gen: number, key: string }>,
 *   current_gen: number,
 *   last_hlc?: { wall: number, logical: number } | null,
 * }} SharedCabinetKeys
 */

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @returns {Promise<SharedCabinetKeys | null>} 密钥
 */
export async function loadSharedKeys(username, cabinetId) {
	try {
		const raw = JSON.parse(await readFile(sharedCabinetKeysPath(username, cabinetId), 'utf8'))
		return {
			write_privkey: raw.write_privkey || undefined,
			write_pubkey: String(raw.write_pubkey || ''),
			read_keys: Array.isArray(raw.read_keys) ? raw.read_keys : [],
			current_gen: Number(raw.current_gen) || 0,
			last_hlc: raw.last_hlc || null,
		}
	}
	catch {
		return null
	}
}

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {SharedCabinetKeys} keys 密钥
 * @returns {Promise<void>}
 */
export async function saveSharedKeys(username, cabinetId, keys) {
	const path = sharedCabinetKeysPath(username, cabinetId)
	await mkdir(path.replace(/[/\\][^/\\]+$/, ''), { recursive: true })
	await writeFile(path, JSON.stringify(keys, null, '\t'), 'utf8')
}

/**
 * @param {string} username 用户
 * @returns {Promise<object[]>} 登记的共享柜元数据
 */
export async function loadSharedRegistry(username) {
	try {
		const raw = JSON.parse(await readFile(sharedCabinetsRegistryPath(username), 'utf8'))
		return Array.isArray(raw?.cabinets) ? raw.cabinets : []
	}
	catch {
		return []
	}
}

/**
 * @param {string} username 用户
 * @param {object[]} cabinets 登记表
 * @returns {Promise<void>}
 */
export async function saveSharedRegistry(username, cabinets) {
	const path = sharedCabinetsRegistryPath(username)
	await mkdir(path.replace(/[/\\][^/\\]+$/, ''), { recursive: true })
	await writeFile(path, JSON.stringify({ cabinets }, null, '\t'), 'utf8')
}

/**
 * @param {string} username 用户
 * @param {{ name?: string }} [draft] 草稿
 * @returns {Promise<{ cabinet: object, keys: SharedCabinetKeys }>} 新建共享柜
 */
export async function createSharedCabinet(username, draft = {}) {
	const { secretKey, publicKey } = await randomKeyPair()
	const { cabinetId } = writeIdentityFromSecret(secretKey)
	const readKey = randomBytes(32).toString('hex')
	/** @type {SharedCabinetKeys} */
	const keys = {
		write_privkey: Buffer.from(secretKey).toString('hex'),
		write_pubkey: Buffer.from(publicKey).toString('hex'),
		read_keys: [{ gen: 0, key: readKey }],
		current_gen: 0,
		last_hlc: null,
	}
	await saveSharedKeys(username, cabinetId, keys)
	const cabinet = {
		cabinet_id: cabinetId,
		name: String(draft.name || 'shared').slice(0, 256),
		type: 'shared',
		write_pubkey: keys.write_pubkey,
		created_at: Date.now(),
		can_write: true,
		can_read: true,
	}
	const registry = await loadSharedRegistry(username)
	registry.push({
		cabinet_id: cabinetId,
		name: cabinet.name,
		write_pubkey: keys.write_pubkey,
		created_at: cabinet.created_at,
	})
	await saveSharedRegistry(username, registry)
	return { cabinet, keys }
}

/**
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @returns {Promise<object | null>} 柜元数据
 */
export async function getSharedCabinetMeta(username, cabinetId) {
	const keys = await loadSharedKeys(username, cabinetId)
	if (!keys) return null
	const registry = await loadSharedRegistry(username)
	const row = registry.find(item => item.cabinet_id === cabinetId)
	return {
		cabinet_id: cabinetId,
		name: row?.name || cabinetId.slice(0, 8),
		type: 'shared',
		write_pubkey: keys.write_pubkey,
		created_at: row?.created_at || 0,
		can_write: Boolean(keys.write_privkey),
		can_read: keys.read_keys.length > 0,
		current_gen: keys.current_gen,
	}
}

/**
 * @param {string} username 用户
 * @returns {Promise<object[]>} 本机可读共享柜
 */
export async function listLocalSharedCabinets(username) {
	const registry = await loadSharedRegistry(username)
	/** @type {object[]} */
	const out = []
	for (const row of registry) {
		const meta = await getSharedCabinetMeta(username, row.cabinet_id)
		if (meta?.can_read) out.push(meta)
	}
	return out
}

/**
 * @param {SharedCabinetKeys} keys 密钥
 * @param {number} [gen] 代际；缺省当前
 * @returns {string | null} 读密钥 hex
 */
export function readKeyForGen(keys, gen) {
	const target = gen == null ? keys.current_gen : Number(gen)
	const row = keys.read_keys.find(item => item.gen === target)
	return row?.key || null
}

/**
 * 升代：生成新读密钥，可选丢弃旧写私钥以外的历史（保留旧代读密钥以便读历史 op）。
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @returns {Promise<{ gen: number, key: string }>} 新代
 */
export async function rotateSharedReadKey(username, cabinetId) {
	const keys = await loadSharedKeys(username, cabinetId)
	if (!keys?.write_privkey) throw new Error('write key required to rotate')
	const nextGen = keys.current_gen + 1
	const key = randomBytes(32).toString('hex')
	keys.read_keys.push({ gen: nextGen, key })
	keys.current_gen = nextGen
	await saveSharedKeys(username, cabinetId, keys)
	return { gen: nextGen, key }
}

/**
 * 导入 chat 分发的密钥材料。
 * @param {string} username 用户
 * @param {string} cabinetId 柜
 * @param {{
 *   write_pubkey: string,
 *   write_privkey?: string,
 *   read_keys?: Array<{ gen: number, key: string }>,
 *   name?: string,
 * }} grant 授权
 * @returns {Promise<SharedCabinetKeys>} 合并后密钥
 */
export async function importSharedCabinetGrant(username, cabinetId, grant) {
	const existing = await loadSharedKeys(username, cabinetId) || {
		write_pubkey: String(grant.write_pubkey || ''),
		read_keys: [],
		current_gen: 0,
		last_hlc: null,
	}
	if (grant.write_privkey) existing.write_privkey = grant.write_privkey
	if (grant.write_pubkey) existing.write_pubkey = grant.write_pubkey
	const byGen = new Map(existing.read_keys.map(row => [row.gen, row]))
	for (const row of grant.read_keys || [])
		if (row?.key != null && Number.isFinite(row.gen))
			byGen.set(Number(row.gen), { gen: Number(row.gen), key: String(row.key) })
	existing.read_keys = [...byGen.values()].sort((a, b) => a.gen - b.gen)
	existing.current_gen = existing.read_keys.reduce((max, row) => Math.max(max, row.gen), 0)
	await saveSharedKeys(username, cabinetId, existing)

	const registry = await loadSharedRegistry(username)
	if (!registry.some(row => row.cabinet_id === cabinetId)) {
		registry.push({
			cabinet_id: cabinetId,
			name: String(grant.name || cabinetId.slice(0, 8)).slice(0, 256),
			write_pubkey: existing.write_pubkey,
			created_at: Date.now(),
		})
		await saveSharedRegistry(username, registry)
	}
	else if (grant.name) {
		const row = registry.find(item => item.cabinet_id === cabinetId)
		if (row) row.name = String(grant.name).slice(0, 256)
		await saveSharedRegistry(username, registry)
	}
	return existing
}

/**
 * @param {SharedCabinetKeys} keys 密钥
 * @returns {{ hlc: { wall: number, logical: number }, keys: SharedCabinetKeys }} 下一 HLC
 */
export function nextSharedHlc(keys) {
	const hlc = nextHlc(keys.last_hlc || undefined)
	return { hlc, keys: { ...keys, last_hlc: hlc } }
}
