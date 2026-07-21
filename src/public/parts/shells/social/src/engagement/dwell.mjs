import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { getUserDictionary } from '../../../../../../server/auth/index.mjs'
import {
	AUTHOR_BOOST_PER_DWELL,
	normalizeDwellEntry,
	TAG_WEIGHT_PER_DWELL,
} from '../lib/dwellSignal.mjs'
import { extractHashtagsFromText } from '../lib/hashtags.mjs'

/**
 *
 */
export {
	AUTHOR_BOOST_PER_DWELL,
	DWELL_MIN_MS,
	normalizeDwellEntry,
	TAG_WEIGHT_PER_DWELL,
} from '../lib/dwellSignal.mjs'

const DWELL_RETENTION_MS = 30 * 86_400_000
const DWELL_MAX_LINES = 5000

/**
 * @param {string} username replica
 * @param {string} entityHash 观看者
 * @returns {string} dwell.jsonl 路径
 */
export function dwellLogPath(username, entityHash) {
	const hash = String(entityHash || '').trim().toLowerCase()
	return path.join(getUserDictionary(username), 'shells/social/taste/dwell', `${hash}.jsonl`)
}

/**
 * @param {string} username replica
 * @param {string} entityHash 观看者
 * @returns {Promise<object[]>} 未过期条目
 */
export async function loadDwellEntries(username, entityHash) {
	const filePath = dwellLogPath(username, entityHash)
	try {
		const text = await readFile(filePath, 'utf8')
		const cutoff = Date.now() - DWELL_RETENTION_MS
		const entries = []
		for (const line of text.split('\n')) {
			if (!line.trim()) continue
			try {
				const entry = normalizeDwellEntry(JSON.parse(line))
				if (!entry || entry.at < cutoff) continue
				entries.push(entry)
			}
			catch { /* skip bad line */ }
		}
		return entries.slice(-DWELL_MAX_LINES)
	}
	catch (err) {
		if (err?.code === 'ENOENT') return []
		throw err
	}
}

/**
 * 追加停留信号并滚动裁剪旧数据。
 * @param {string} username replica
 * @param {string} entityHash 观看者
 * @param {object[]} rows 信号列表
 * @returns {Promise<{ accepted: number }>} 写入统计
 */
export async function appendDwellSignals(username, entityHash, rows) {
	const accepted = []
	for (const raw of rows || []) {
		const entry = normalizeDwellEntry(raw)
		if (entry) accepted.push(entry)
	}
	if (!accepted.length) return { accepted: 0 }
	const filePath = dwellLogPath(username, entityHash)
	await mkdir(path.dirname(filePath), { recursive: true })
	const payload = `${accepted.map(entry => JSON.stringify(entry)).join('\n')}\n`
	await appendFile(filePath, payload, 'utf8')

	const all = await loadDwellEntries(username, entityHash)
	if (all.length > DWELL_MAX_LINES * 0.9) {
		const kept = all.slice(-Math.floor(DWELL_MAX_LINES * 0.8))
		await writeFile(filePath, `${kept.map(entry => JSON.stringify(entry)).join('\n')}\n`, 'utf8')
	}
	return { accepted: accepted.length }
}

/**
 * 作者亲和弱加权（每次有效停留 +0.25）。
 * @param {string} username replica
 * @param {string} entityHash 观看者
 * @returns {Promise<Map<string, number>>} 作者 → dwell 亲和加成
 */
export async function loadDwellAuthorBoosts(username, entityHash) {
	/** @type {Map<string, number>} */
	const boosts = new Map()
	for (const entry of await loadDwellEntries(username, entityHash))
		boosts.set(entry.author, (boosts.get(entry.author) || 0) + AUTHOR_BOOST_PER_DWELL)
	return boosts
}

/**
 * 标签弱证据（每次有效停留对帖标签 +0.15）。
 * @param {string} username replica
 * @param {string} entityHash 观看者
 * @returns {Promise<Map<string, number>>} tag → 权重增量
 */
export async function loadDwellTagBoosts(username, entityHash) {
	/** @type {Map<string, number>} */
	const boosts = new Map()
	for (const entry of await loadDwellEntries(username, entityHash))
		for (const tag of entry.tags)
			boosts.set(tag, (boosts.get(tag) || 0) + TAG_WEIGHT_PER_DWELL)
	return boosts
}

/**
 * @param {string} text 正文
 * @returns {string[]} 标签
 */
export function tagsFromPostText(text) {
	return extractHashtagsFromText(text)
}
