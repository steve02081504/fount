/**
 * 统一的阅读进度存储：按 `<userdict>/read_progress/<scope>.json` 保存每个作用域下
 * key → 位置锚点。social（帖子详情）与 gist（文档查看）共用本模块，记录格式一致：
 * `{ anchor: { blockIndex, blockSig, offsetRatio }, ratio, updatedAt }`。
 *
 * 位置以「内容块指纹 + 块内比例」表达而非像素，故前后窗口尺寸变化后仍能落到同一段内容。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { getUserDictionary } from './auth/index.mjs'

/** 默认保留条数（按更新时间淘汰）。 */
export const DEFAULT_MAX_ENTRIES = 1000
/** 内容块指纹最大长度。 */
const SIG_MAX_LEN = 96
/** 单次写入的 key 数量上限，避免异常大 body。 */
const MAX_ENTRIES_PER_WRITE = 50

/** 路径 → 串行写队列，避免并发读改写互相覆盖。 */
const writeChains = new Map()

/**
 * 校验作用域名（作为文件名，仅允许安全字符）。
 * @param {string} scope 作用域名
 * @returns {string} 作用域名
 */
function assertScope(scope) {
	const value = String(scope ?? '')
	if (!/^[\w-]{1,64}$/.test(value))
		throw new Error(`invalid read_progress scope: ${value}`)
	return value
}

/**
 * 返回作用域存储文件路径。
 * @param {string} username 用户
 * @param {string} scope 作用域名
 * @returns {string} 文件绝对路径
 */
export function readProgressPath(username, scope) {
	return path.join(getUserDictionary(username), 'read_progress', `${assertScope(scope)}.json`)
}

/**
 * @param {unknown} value 原始值
 * @returns {number} 夹到 [0,1] 的数
 */
function clamp01(value) {
	const n = Number(value)
	if (!Number.isFinite(n)) return 0
	if (n < 0) return 0
	if (n > 1) return 1
	return n
}

/**
 * 规范化位置锚点，非法时返回 null。
 * @param {unknown} raw 原始锚点
 * @returns {{ blockIndex: number, blockSig: string, offsetRatio: number } | null} 规范化锚点
 */
function normalizeAnchor(raw) {
	if (!raw || typeof raw !== 'object') return null
	const blockSig = typeof raw.blockSig === 'string' ? raw.blockSig.slice(0, SIG_MAX_LEN) : ''
	const blockIndex = Number.isInteger(raw.blockIndex) && raw.blockIndex >= 0 ? raw.blockIndex : -1
	if (!blockSig && blockIndex < 0) return null
	return { blockIndex, blockSig, offsetRatio: clamp01(raw.offsetRatio) }
}

/**
 * 规范化单条记录，非法时返回 null。
 * @param {unknown} raw 原始记录
 * @param {number} [now] 缺失时间时的回退时间戳
 * @returns {{ anchor: object, ratio: number, updatedAt: number } | null} 规范化记录
 */
function normalizeRecord(raw, now = Date.now()) {
	if (!raw || typeof raw !== 'object') return null
	const anchor = normalizeAnchor(raw.anchor)
	if (!anchor) return null
	const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : now
	return { anchor, ratio: clamp01(raw.ratio), updatedAt }
}

/**
 * 读取作用域下的全部记录（读失败/损坏 → 空对象）。
 * @param {string} username 用户
 * @param {string} scope 作用域名
 * @returns {Promise<Record<string, object>>} key → 记录
 */
export async function loadReadProgress(username, scope) {
	let raw
	try {
		raw = JSON.parse(await readFile(readProgressPath(username, scope), 'utf8'))
	}
	catch {
		return {}
	}
	if (!raw || typeof raw !== 'object') return {}
	const entries = {}
	for (const [key, value] of Object.entries(raw)) {
		const record = normalizeRecord(value)
		if (record) entries[key] = record
	}
	return entries
}

/**
 * 读取单个 key 的进度记录。
 * @param {string} username 用户
 * @param {string} scope 作用域名
 * @param {string} key 记录键
 * @returns {Promise<object | null>} 记录或 null
 */
export async function getReadProgress(username, scope, key) {
	const entries = await loadReadProgress(username, scope)
	return entries[key] ?? null
}

/**
 * 按更新时间淘汰，保留最近 maxEntries 条。
 * @param {Record<string, object>} entries 记录表
 * @param {number} maxEntries 上限
 * @returns {Record<string, object>} 淘汰后的记录表
 */
function pruneEntries(entries, maxEntries) {
	const keys = Object.keys(entries)
	if (keys.length <= maxEntries) return entries
	keys.sort((a, b) => (entries[b].updatedAt ?? 0) - (entries[a].updatedAt ?? 0))
	const kept = {}
	for (const key of keys.slice(0, maxEntries)) kept[key] = entries[key]
	return kept
}

/**
 * @param {string} filePath 文件路径
 * @param {() => Promise<T>} task 写任务
 * @returns {Promise<T>} 任务结果
 * @template T
 */
function enqueueWrite(filePath, task) {
	const previous = writeChains.get(filePath) ?? Promise.resolve()
	const run = previous.then(task, task)
	writeChains.set(filePath, run.then(() => { }, () => { }))
	return run
}

/**
 * 合并并写入进度记录，服务端赋值 updatedAt 后按更新时间淘汰。
 * @param {string} username 用户
 * @param {string} scope 作用域名
 * @param {{ key: string, anchor: object, ratio?: number }[]} entries 待写入记录
 * @param {{ maxEntries?: number }} [options] 选项
 * @returns {Promise<{ saved: number, total: number }>} 写入统计
 */
export async function saveReadProgress(username, scope, entries, { maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
	const now = Date.now()
	const incoming = []
	for (const row of (entries || []).slice(0, MAX_ENTRIES_PER_WRITE)) {
		const key = String(row?.key ?? '')
		if (!key) continue
		const record = normalizeRecord({ ...row, updatedAt: now }, now)
		if (record) incoming.push([key, record])
	}
	if (!incoming.length) return { saved: 0, total: 0 }
	const filePath = readProgressPath(username, scope)
	return enqueueWrite(filePath, async () => {
		const merged = await loadReadProgress(username, scope)
		for (const [key, record] of incoming) merged[key] = record
		const kept = pruneEntries(merged, Math.max(1, maxEntries))
		await mkdir(path.dirname(filePath), { recursive: true })
		await writeFile(filePath, JSON.stringify(kept, null, '\t'), 'utf8')
		return { saved: incoming.length, total: Object.keys(kept).length }
	})
}
