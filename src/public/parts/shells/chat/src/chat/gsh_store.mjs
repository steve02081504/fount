/**
 * GSH 状态本地存储（§11、§19）
 *
 * 每个群在 `shellData/chat/groups/{groupId}/gsh.json` 中存储 H 代数历史，
 * 供加密消息时取当前 H、解密时按 generation 查历史 H。
 *
 * 格式：
 * ```json
 * {
 *   "schema": 1,
 *   "current": 0,
 *   "generations": [
 *     { "gen": 0, "h": "<32字节hex>" }
 *   ]
 * }
 * ```
 * generations 按 gen 升序排列；最大 gen 即为 current。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { generateH } from '../../../../../../scripts/p2p/gsh.mjs'

import { gshPath } from './paths.mjs'

/** 最多保留多少代历史 H（用于解密积压的旧消息） */
const MAX_GENERATIONS = 64

/**
 * @typedef {{ schema: number, current: number, generations: Array<{ gen: number, h: string }> }} GshFile
 */

/**
 * @param {unknown} raw 磁盘读取的原始 JSON 对象（未经校验）
 * @returns {GshFile} 规范化后的 GSH 文件对象
 */
function normalizeGshFile(raw) {
	if (!raw || typeof raw !== 'object')
		return { schema: 1, current: -1, generations: [] }
	const o = /** @type {Record<string, unknown>} */ raw
	const gens = Array.isArray(o.generations)
		? o.generations.filter(g => g && typeof g === 'object' && typeof g.gen === 'number' && typeof g.h === 'string')
		: []
	gens.sort((a, b) => a.gen - b.gen)
	const current = gens.length ? gens[gens.length - 1].gen : -1
	return { schema: 1, current, generations: gens }
}

/**
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @returns {Promise<GshFile>} 规范化后的 GSH 文件对象；不存在时返回空结构
 */
export async function loadGsh(username, groupId) {
	try {
		const text = await readFile(gshPath(username, groupId), 'utf8')
		return normalizeGshFile(JSON.parse(text))
	}
	catch { return normalizeGshFile(null) }
}

/**
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @param {GshFile} data 待保存的 GSH 文件对象
 * @returns {Promise<void>} 写入完成
 */
async function saveGsh(username, groupId, data) {
	const p = gshPath(username, groupId)
	await mkdir(dirname(p), { recursive: true })
	// 只保留最近 MAX_GENERATIONS 代
	const gens = data.generations.slice(-MAX_GENERATIONS)
	const current = gens.length ? gens[gens.length - 1].gen : -1
	const out = { schema: 1, current, generations: gens }
	await writeFile(p, JSON.stringify(out, null, '\t'), 'utf8')
}

/**
 * 获取当前（最新代）的 H。
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @returns {Promise<{ h: string, generation: number } | null>} 当前 H 及代数；无记录时返回 null
 */
export async function getCurrentH(username, groupId) {
	const data = await loadGsh(username, groupId)
	if (!data.generations.length) return null
	const last = data.generations[data.generations.length - 1]
	return { h: last.h, generation: last.gen }
}

/**
 * 按 generation 查找 H（用于解密历史消息）。
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @param {number} generation H 代数
 * @returns {Promise<string | null>} H hex；无此代记录时返回 null
 */
export async function getHByGeneration(username, groupId, generation) {
	const data = await loadGsh(username, groupId)
	const entry = data.generations.find(g => g.gen === generation)
	return entry ? entry.h : null
}

/**
 * 群初始化时生成并存储 H（generation 0）。
 * 若已存在则不覆盖，直接返回现有 H。
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @returns {Promise<{ h: string, generation: number }>} 当前 H 及代数（generation 0）
 */
export async function initGroupH(username, groupId) {
	const existing = await getCurrentH(username, groupId)
	if (existing) return existing
	const h = generateH()
	const data = { schema: 1, current: 0, generations: [{ gen: 0, h }] }
	await saveGsh(username, groupId, data)
	return { h, generation: 0 }
}

/**
 * 追加新的 H（踢人/key_rotate 后调用）。
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @param {number} generation 新代数（应为 current + 1）
 * @param {string} h_hex 新 H（32 字节十六进制）
 * @returns {Promise<void>} 写入完成
 */
export async function appendH(username, groupId, generation, h_hex) {
	const data = await loadGsh(username, groupId)
	// 去重：同代数已存在则跳过（并发踢人保护）
	if (data.generations.some(g => g.gen === generation)) return
	data.generations.push({ gen: generation, h: h_hex })
	data.generations.sort((a, b) => a.gen - b.gen)
	await saveGsh(username, groupId, data)
}

/**
 * 从已落盘的 `member_kick` / `key_rotate` 事件推导并写入新 H（联邦入站与本地踢人共用）。
 * @param {string} username 本地用户
 * @param {string} groupId 群 ID
 * @param {{ id: string, type: string, content?: { key_generation?: number, new_H_nonce?: string } }} event 签名事件
 * @returns {Promise<void>}
 */
export async function applyGshRotationFromEvent(username, groupId, event) {
	if (event.type !== 'member_kick' && event.type !== 'key_rotate') return
	const c = event.content && typeof event.content === 'object' ? event.content : {}
	const gen = c.key_generation
	const nonce = typeof c.new_H_nonce === 'string' ? c.new_H_nonce.trim() : ''
	if (typeof gen !== 'number' || !Number.isFinite(gen) || gen < 0 || !nonce) return

	const hEntry = await getCurrentH(username, groupId)
	if (!hEntry) return

	const { deriveNewH } = await import('../../../../../../scripts/p2p/gsh.mjs')
	const newGen = Math.floor(gen)
	if (newGen <= hEntry.generation) return

	const newH = deriveNewH(hEntry.h, event.id, nonce)
	await appendH(username, groupId, newGen, newH)
}
