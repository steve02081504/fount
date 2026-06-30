/**
 * 群文件主密钥（fileMasterKey）本地持久化：维护代数历史，供文件加密与成员变更轮换。
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { debugLog } from '../../../../../../../scripts/debug_log.mjs'
import { clearMasterKeyKdfCache, deriveNextFileMasterKey } from '../../../../../../../scripts/p2p/key_crypto.mjs'
import { fileMasterKeysPath } from '../lib/paths.mjs'

/** 最多保留多少代历史密钥（用于解密旧文件块） */
const MAX_GENERATIONS = 64

/**
 * @typedef {{ current: number, generations: Array<{ gen: number, fileMasterKey: string }> }} FileMasterKeysFile
 */

/**
 * @param {unknown} raw 磁盘读取的原始 JSON 对象（未经校验）
 * @returns {FileMasterKeysFile} 规范化后的文件对象
 */
function normalizeFileMasterKeysFile(raw) {
	const generations = (raw?.generations ?? [])
		.filter(g => g?.fileMasterKey && Number.isFinite(g.gen))
		.map(g => ({ gen: g.gen, fileMasterKey: g.fileMasterKey }))
		.sort((a, b) => a.gen - b.gen)
	return {
		current: generations.length ? generations.at(-1).gen : -1,
		generations,
	}
}

/**
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @returns {Promise<FileMasterKeysFile>} 规范化后的文件对象；不存在时返回空结构
 */
export async function loadFileMasterKeys(username, groupId) {
	try {
		const text = await readFile(fileMasterKeysPath(username, groupId), 'utf8')
		return normalizeFileMasterKeysFile(JSON.parse(text))
	}
	catch (error) {
		if (error?.code !== 'ENOENT')
			await debugLog('file-master-key-load-fail', { username, groupId, message: error?.message }).catch(() => { })
		return normalizeFileMasterKeysFile(null)
	}
}

/**
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @param {FileMasterKeysFile} data 待保存的对象
 * @returns {Promise<void>} 写入完成
 */
async function saveFileMasterKeys(username, groupId, data) {
	const p = fileMasterKeysPath(username, groupId)
	await mkdir(dirname(p), { recursive: true })
	const gens = data.generations.slice(-MAX_GENERATIONS)
	const current = gens.length ? gens[gens.length - 1].gen : -1
	const out = { current, generations: gens }
	await writeFile(p, JSON.stringify(out, null, '\t'), 'utf8')
}

/**
 * 获取当前（最新代）群文件主密钥。
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @returns {Promise<{ fileMasterKey: string, generation: number } | null>} 当前密钥及代数；无记录时为 null
 */
export async function getCurrentFileMasterKey(username, groupId) {
	const data = await loadFileMasterKeys(username, groupId)
	if (!data.generations.length) return null
	const last = data.generations[data.generations.length - 1]
	return { fileMasterKey: last.fileMasterKey, generation: last.gen }
}

/**
 * 按 generation 查找群文件主密钥。
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @param {number} generation 代数
 * @returns {Promise<string | null>} 32 字节 hex
 */
export async function getFileMasterKeyByGeneration(username, groupId, generation) {
	const data = await loadFileMasterKeys(username, groupId)
	const entry = data.generations.find(g => g.gen === generation)
	return entry ? entry.fileMasterKey : null
}

/**
 * 群初始化时生成并存储 fileMasterKey（generation 0）；若已存在则不覆盖。
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @returns {Promise<{ fileMasterKey: string, generation: number }>} 当前密钥及代数
 */
export async function initGroupFileMasterKey(username, groupId) {
	const existing = await getCurrentFileMasterKey(username, groupId)
	if (existing) return existing
	const fileMasterKey = randomBytes(32).toString('hex')
	const data = { current: 0, generations: [{ gen: 0, fileMasterKey }] }
	await saveFileMasterKeys(username, groupId, data)
	return { fileMasterKey, generation: 0 }
}

/**
 * 追加新的群文件主密钥（踢人/key_rotate 后调用）。
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @param {number} generation 新代数（应为 current + 1）
 * @param {string} fileMasterKeyHex 新密钥（32 字节十六进制）
 * @returns {Promise<void>}
 */
export async function appendFileMasterKey(username, groupId, generation, fileMasterKeyHex) {
	const data = await loadFileMasterKeys(username, groupId)
	if (data.generations.some(g => g.gen === generation)) return
	data.generations.push({ gen: generation, fileMasterKey: fileMasterKeyHex })
	data.generations.sort((a, b) => a.gen - b.gen)
	clearMasterKeyKdfCache()
	await saveFileMasterKeys(username, groupId, data)
}

/**
 * 从已落盘的 `member_kick` / `key_rotate` 事件推导并写入新 fileMasterKey。
 * @param {string} username 本地用户
 * @param {string} groupId 群 ID
 * @param {{ id: string, type: string, content?: { key_generation?: number, new_key_nonce?: string } }} event 签名事件
 * @returns {Promise<void>}
 */
export async function applyFileMasterKeyRotationFromEvent(username, groupId, event) {
	if (event.type !== 'member_kick' && event.type !== 'key_rotate') return
	const c = event.content
	const gen = c.key_generation
	const nonce = c.new_key_nonce?.trim()
	if (!Number.isFinite(gen) || gen < 0 || !nonce) return

	const entry = await getCurrentFileMasterKey(username, groupId)
	if (!entry) return

	const newGen = Math.floor(gen)
	if (newGen <= entry.generation) return

	const newKey = deriveNextFileMasterKey(entry.fileMasterKey, event.id, nonce)
	await appendFileMasterKey(username, groupId, newGen, newKey)
	const { flushPendingDecryptAfterFileKeyRotation } = await import('./buffer.mjs')
	flushPendingDecryptAfterFileKeyRotation(username, groupId, newGen)
}
