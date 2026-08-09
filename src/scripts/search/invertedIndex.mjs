import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { withAsyncMutex } from 'npm:@steve02081504/fount-p2p/utils/async_mutex'

import { TOKENIZER_VERSION, tokenizeForQuery } from './tokenize.mjs'

/**
 * 分片级互斥包装，避免并发写同一索引分片。
 * @param {string} key 分片互斥键
 * @param {() => Promise<unknown>} fn 临界区任务
 * @returns {Promise<unknown>} fn 的返回值
 */
const shardMutex = (key, fn) => withAsyncMutex(`search-index:${key}`, fn)

/**
 * @param {string} indexDir 索引根目录
 * @param {string} shardKey 分片键
 * @returns {string} 分片目录
 */
export function shardDir(indexDir, shardKey) {
	return join(indexDir, shardKey)
}

/**
 * 非递归创建单层目录；父目录已不存在时返回 false（不复活上层树）。
 * @param {string} path 目录
 * @returns {Promise<boolean>} 已存在或创建成功
 */
async function mkdirLeaf(path) {
	try {
		await mkdir(path)
		return true
	}
	catch (error) {
		if (error?.code === 'EEXIST') return true
		if (error?.code === 'ENOENT') return false
		throw error
	}
}

/**
 * 确保分片目录可用；索引根的父目录已删除时返回 null（leave/删群竞态）。
 * @param {string} indexDir 索引根
 * @param {string} shardKey 分片键
 * @returns {Promise<string | null>} 分片目录或 null
 */
async function ensureShardDir(indexDir, shardKey) {
	if (!await mkdirLeaf(indexDir)) return null
	const dir = shardDir(indexDir, shardKey)
	if (!await mkdirLeaf(dir)) return null
	return dir
}

/**
 * 落盘 I/O：leave/删群竞态下的 ENOENT / EEXIST 视为无操作。
 * @template T
 * @param {() => Promise<T>} fn 临界区
 * @returns {Promise<T | undefined>}
 */
async function withGoneParentOk(fn) {
	try {
		return await fn()
	}
	catch (error) {
		// ENOENT: leave/删群；EEXIST: Deno mkdir 竞态（含依赖里 recursive mkdir）
		if (error?.code === 'ENOENT' || error?.code === 'EEXIST') return undefined
		throw error
	}
}

/**
 * 追加 docs.jsonl 一行并 fsync；不 mkdir（避免 recursive 复活已删父树）。
 * @param {string} dir 分片目录
 * @param {object} record 文档行
 * @returns {Promise<void>}
 */
async function appendDocsLine(dir, record) {
	const fh = await open(join(dir, 'docs.jsonl'), 'a')
	try {
		await fh.appendFile(`${JSON.stringify(record)}\n`, 'utf8')
		await fh.sync()
	}
	finally {
		await fh.close()
	}
}

/**
 * @param {string} dir 分片目录
 * @returns {Promise<object>} meta
 */
async function readMeta(dir) {
	try {
		return JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
	}
	catch {
		return {
			tokenizerVersion: TOKENIZER_VERSION,
			docCount: 0,
			watermark: null,
			coverage: {},
		}
	}
}

/**
 * @param {string} dir 分片目录
 * @param {object} meta meta
 * @returns {Promise<void>}
 */
async function writeMeta(dir, meta) {
	await writeFile(join(dir, 'meta.json'), `${JSON.stringify(meta)}\n`, 'utf8')
}

/**
 * @param {string} dir 分片目录
 * @returns {Promise<Record<string, string[]>>} postings
 */
async function readPostings(dir) {
	try {
		return JSON.parse(await readFile(join(dir, 'postings.json'), 'utf8'))
	}
	catch {
		return {}
	}
}

/**
 * @param {string} dir 分片目录
 * @param {Record<string, string[]>} postings postings
 * @returns {Promise<void>}
 */
async function writePostings(dir, postings) {
	await writeFile(join(dir, 'postings.json'), `${JSON.stringify(postings)}\n`, 'utf8')
}

/**
 * @param {object[]} rows docs.jsonl 行
 * @returns {Map<string, object>} id → 最新文档
 */
function foldDocs(rows) {
	/** @type {Map<string, object>} */
	const byId = new Map()
	for (const row of rows) {
		if (!row?.id) continue
		byId.set(String(row.id), row)
	}
	return byId
}

/**
 * @param {string} indexDir 索引根
 * @param {string} shardKey 分片
 * @returns {Promise<object>} meta
 */
export async function getShardMeta(indexDir, shardKey) {
	const dir = shardDir(indexDir, shardKey)
	return readMeta(dir)
}

/**
 * @param {string} indexDir 索引根
 * @param {string} shardKey 分片
 * @param {object} patch 补丁
 * @returns {Promise<object | undefined>} 更新后 meta；父树已删时 undefined
 */
export async function patchShardMeta(indexDir, shardKey, patch) {
	return shardMutex(`${indexDir}:${shardKey}:meta`, () => withGoneParentOk(async () => {
		const dir = await ensureShardDir(indexDir, shardKey)
		if (!dir) return undefined
		const meta = { ...await readMeta(dir), ...patch }
		await writeMeta(dir, meta)
		return meta
	}))
}

/**
 * @param {string} indexDir 索引根
 * @param {string} shardKey 分片
 * @param {object} doc 文档
 * @param {string} doc.id 文档 ID
 * @param {string} doc.text 索引文本
 * @param {number} [doc.ts] 时间戳
 * @param {object} [doc.fields] 附加字段
 * @returns {Promise<void>}
 */
export async function indexDocument(indexDir, shardKey, doc) {
	const id = String(doc.id || '')
	if (!id) return
	const text = String(doc.text || '')
	const tokens = tokenizeForQuery(text)

	await shardMutex(`${indexDir}:${shardKey}`, () => withGoneParentOk(async () => {
		const dir = await ensureShardDir(indexDir, shardKey)
		if (!dir) return
		const postings = await readPostings(dir)
		const rows = await readJsonl(join(dir, 'docs.jsonl'))
		const prev = foldDocs(rows).get(id)
		if (prev && !prev.deleted)
			for (const token of tokenizeForQuery(String(prev.text || ''))) {
				const list = postings[token]
				if (!list) continue
				postings[token] = list.filter(entry => entry !== id)
				if (!postings[token].length) delete postings[token]
			}


		for (const token of tokens) {
			if (!postings[token]) postings[token] = []
			if (!postings[token].includes(id)) postings[token].push(id)
		}

		await appendDocsLine(dir, {
			id,
			text,
			ts: Number(doc.ts) || Date.now(),
			fields: doc.fields || {},
			deleted: false,
		})
		await writePostings(dir, postings)

		const meta = await readMeta(dir)
		meta.tokenizerVersion = TOKENIZER_VERSION
		meta.docCount = [...foldDocs([...rows, { id, deleted: false }]).values()].filter(row => !row.deleted).length
		await writeMeta(dir, meta)
	}))
}

/**
 * @param {string} indexDir 索引根
 * @param {string} shardKey 分片
 * @param {string} id 文档 ID
 * @returns {Promise<void>}
 */
export async function removeDocument(indexDir, shardKey, id) {
	const docId = String(id || '')
	if (!docId) return

	await shardMutex(`${indexDir}:${shardKey}`, () => withGoneParentOk(async () => {
		const dir = shardDir(indexDir, shardKey)
		const rows = await readJsonl(join(dir, 'docs.jsonl'))
		const prev = foldDocs(rows).get(docId)
		if (!prev || prev.deleted) return

		const postings = await readPostings(dir)
		for (const token of tokenizeForQuery(String(prev.text || ''))) {
			const list = postings[token]
			if (!list) continue
			postings[token] = list.filter(entry => entry !== docId)
			if (!postings[token].length) delete postings[token]
		}

		await appendDocsLine(dir, {
			id: docId,
			text: prev.text || '',
			ts: prev.ts || Date.now(),
			fields: prev.fields || {},
			deleted: true,
		})
		await writePostings(dir, postings)

		const meta = await readMeta(dir)
		meta.docCount = Math.max(0, (meta.docCount || 0) - 1)
		await writeMeta(dir, meta)
	}))
}

/**
 * @param {string} indexDir 索引根
 * @param {string} shardKey 分片
 * @returns {Promise<Map<string, object>>} 活跃文档
 */
export async function loadActiveDocs(indexDir, shardKey) {
	const dir = shardDir(indexDir, shardKey)
	const rows = await readJsonl(join(dir, 'docs.jsonl'))
	const folded = foldDocs(rows)
	/** @type {Map<string, object>} */
	const active = new Map()
	for (const [id, row] of folded)
		if (!row.deleted) active.set(id, row)

	return active
}

/**
 * @param {object} options 查询选项
 * @param {string} options.indexDir 索引根
 * @param {string[]} options.shardKeys 分片列表
 * @param {string} options.query 查询串
 * @param {number} [options.limit=30] 上限
 * @param {(doc: object) => boolean | Promise<boolean>} [options.verify] 真值校验
 * @returns {Promise<object[]>} 命中文档（含 id/text/ts/fields/shardKey）
 */
export async function queryIndex(options) {
	const {
		indexDir,
		shardKeys,
		query,
		limit = 30,
		verify = () => true,
	} = options
	const tokens = tokenizeForQuery(query)
	if (!tokens.length) return []

	/** @type {Map<string, { doc: object, shardKey: string, hits: number }>} */
	const candidates = new Map()

	for (const shardKey of shardKeys) {
		const dir = shardDir(indexDir, shardKey)
		const postings = await readPostings(dir)
		if (!Object.keys(postings).length) continue
		const active = await loadActiveDocs(indexDir, shardKey)

		/** @type {Map<string, number>} */
		const scoreById = new Map()
		for (const token of tokens)
			for (const docId of postings[token] || []) {
				if (!active.has(docId)) continue
				scoreById.set(docId, (scoreById.get(docId) || 0) + 1)
			}


		for (const [docId, hits] of scoreById) {
			const doc = active.get(docId)
			if (!doc) continue
			const key = `${shardKey}:${docId}`
			const prev = candidates.get(key)
			if (!prev || hits > prev.hits)
				candidates.set(key, { doc, shardKey, hits })
		}
	}

	const ranked = [...candidates.values()]
		.sort((left, right) => right.hits - left.hits || Number(right.doc.ts) - Number(left.doc.ts))

	/** @type {object[]} */
	const results = []
	for (const entry of ranked) {
		const payload = { ...entry.doc, shardKey: entry.shardKey, hits: entry.hits }
		if (!await verify(payload)) continue
		results.push(payload)
		if (results.length >= limit) break
	}
	return results
}
