/**
 * 实体口味偏好表存储（计算权重 / 手动覆盖 / 软别名 / 隐私）。
 * 别名表持久不过期；声明收件箱另行有界。
 * 标签显示名由时间线 tag_name 事件承载，不写入本文件。
 */
import path from 'node:path'

import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { writeJsonAtomic } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { withAsyncMutex } from 'npm:@steve02081504/fount-p2p/utils/async_mutex'

import { getUserDictionary } from '../../../../../../server/auth/index.mjs'

/**
 * @typedef {{
 *   computed: Record<string, number>,
 *   manual: Record<string, number>,
 *   aliases: Record<string, { to: string, confidence: number, evidence?: object }>,
 *   privacy: { publishPreferences: boolean, publishReactions: boolean },
 *   clusteredAt: number,
 *   postTags: Record<string, { tags: string[], selfWeight: number }>,
 * }} TasteStore
 */

/** @returns {TasteStore} 空偏好表 */
export function emptyTasteStore() {
	return {
		computed: {},
		manual: {},
		aliases: {},
		privacy: { publishPreferences: true, publishReactions: true },
		clusteredAt: 0,
		postTags: {},
	}
}

/**
 * @param {string} username replica
 * @param {string} entityHash acting entity
 * @returns {string} 偏好文件路径
 */
export function tasteStorePath(username, entityHash) {
	return path.join(
		getUserDictionary(username),
		'shells/social/taste',
		`${String(entityHash).toLowerCase()}.json`,
	)
}

/**
 * @param {unknown} value 候选记录
 * @returns {Record<string, *>} 浅拷贝或空对象
 */
function asRecord(value) {
	return value && typeof value === 'object' ? { .../** @type {object} */ value } : {}
}

/**
 * @param {object | null | undefined} raw 磁盘数据
 * @returns {TasteStore} 规范化
 */
export function normalizeTasteStore(raw) {
	const base = emptyTasteStore()
	if (!raw || typeof raw !== 'object') return base
	return {
		computed: asRecord(raw.computed),
		manual: asRecord(raw.manual),
		aliases: asRecord(raw.aliases),
		privacy: {
			publishPreferences: raw.privacy?.publishPreferences !== false,
			publishReactions: raw.privacy?.publishReactions !== false,
		},
		clusteredAt: Number(raw.clusteredAt) || 0,
		postTags: asRecord(raw.postTags),
	}
}

/**
 * @param {string} username replica
 * @param {string} entityHash acting entity
 * @returns {Promise<TasteStore>} 偏好表
 */
export async function loadTaste(username, entityHash) {
	const hash = String(entityHash || '').trim().toLowerCase()
	if (!parseEntityHash(hash)) return emptyTasteStore()
	const { readFile } = await import('node:fs/promises')
	try {
		return normalizeTasteStore(JSON.parse(await readFile(tasteStorePath(username, hash), 'utf8')))
	}
	catch (err) {
		if (err?.code !== 'ENOENT') throw err
		return emptyTasteStore()
	}
}

/**
 * @param {string} username replica
 * @param {string} entityHash acting entity
 * @param {TasteStore} store 偏好表
 * @returns {Promise<TasteStore>} 落盘后规范化结果
 */
export async function saveTaste(username, entityHash, store) {
	const hash = String(entityHash || '').trim().toLowerCase()
	if (!parseEntityHash(hash)) throw new Error('invalid entityHash')
	const normalized = normalizeTasteStore(store)
	await withAsyncMutex(`taste-store:${username}:${hash}`, async () => {
		const { mkdir } = await import('node:fs/promises')
		const filePath = tasteStorePath(username, hash)
		await mkdir(path.dirname(filePath), { recursive: true })
		await writeJsonAtomic(filePath, normalized)
	})
	return normalized
}

/**
 * @param {string} username replica
 * @param {string} entityHash acting entity
 * @param {(store: TasteStore) => TasteStore | void | Promise<TasteStore | void>} mutator 突变
 * @returns {Promise<TasteStore>} 写入后偏好
 */
export async function mutateTaste(username, entityHash, mutator) {
	const hash = String(entityHash || '').trim().toLowerCase()
	return withAsyncMutex(`taste-store:${username}:${hash}`, async () => {
		const current = await loadTaste(username, hash)
		const next = await mutator(current) || current
		const normalized = normalizeTasteStore(next)
		const { mkdir } = await import('node:fs/promises')
		const filePath = tasteStorePath(username, hash)
		await mkdir(path.dirname(filePath), { recursive: true })
		await writeJsonAtomic(filePath, normalized)
		return normalized
	})
}

/**
 * 沿软别名表解析 canonical tag（有环则停）。
 * @param {string} tagHash tag
 * @param {Record<string, { to: string, confidence: number }>} aliases 别名表
 * @returns {string} canonical
 */
export function resolveTasteAlias(tagHash, aliases) {
	let current = String(tagHash || '').trim().toLowerCase()
	const seen = new Set()
	while (aliases[current]?.to && !seen.has(current)) {
		seen.add(current)
		current = String(aliases[current].to).trim().toLowerCase()
	}
	return current
}

/**
 * computed + manual 合计权重（经别名）。
 * @param {TasteStore} store 偏好
 * @param {string} tagHash tag
 * @returns {number} 权重
 */
export function tasteWeightOf(store, tagHash) {
	const canon = resolveTasteAlias(tagHash, store.aliases)
	return (Number(store.computed[canon]) || 0) + (Number(store.manual[canon]) || 0)
}

/**
 * 折叠全部 tag 权重（computed + manual）。
 * @param {TasteStore} store 偏好
 * @returns {Map<string, number>} canonical → 合计权重
 */
export function collapseTasteWeights(store) {
	/** @type {Map<string, number>} */
	const collapsed = new Map()
	for (const [raw, weight] of Object.entries(store.computed || {})) {
		const canon = resolveTasteAlias(raw, store.aliases)
		collapsed.set(canon, (collapsed.get(canon) || 0) + (Number(weight) || 0))
	}
	for (const [raw, weight] of Object.entries(store.manual || {})) {
		const canon = resolveTasteAlias(raw, store.aliases)
		collapsed.set(canon, (collapsed.get(canon) || 0) + (Number(weight) || 0))
	}
	return collapsed
}
