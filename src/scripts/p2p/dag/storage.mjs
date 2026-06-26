import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { withAsyncMutex } from '../utils/async_mutex.mjs'

/** 流式重写 JSONL 时分块写入的行数上限 */
const WRITE_JSONL_CHUNK_LINES = 1000

/**
 * @param {string} filePath 目标路径
 * @returns {string} 唯一临时文件路径
 */
function atomicTmpPath(filePath) {
	return `${filePath}.tmp.${process.pid}.${randomUUID()}`
}

/**
 * 读取 JSONL 文件并解析为对象数组；缺失或读失败时返回空数组。
 * @param {string} filePath 文件系统路径
 * @param {{ sanitize?: (row: object) => object }} [options] 可选净化函数
 * @returns {Promise<object[]>} 各行解析后的对象列表
 */
export async function readJsonl(filePath, options = {}) {
	try {
		const text = await readFile(filePath, 'utf8')
		const sanitize = options.sanitize ?? (row => row)
		return text.split('\n').filter(Boolean).map(line => sanitize(JSON.parse(line)))
	}
	catch {
		return []
	}
}

/**
 * 流式读取 JSONL（避免整文件读入内存）。文件缺失（ENOENT）视为空流，
 * 兼容 cleanup 竞态：群目录被删后台仍在尾巴上读它。
 * @param {string} filePath 文件路径
 * @param {{ sanitize?: (row: object) => object }} [options] 行净化
 * @returns {AsyncGenerator<object>} 逐行事件
 */
export async function* readJsonlStream(filePath, options = {}) {
	const sanitize = options.sanitize ?? (row => row)
	const input = createReadStream(filePath, { encoding: 'utf8' })
	// stream 内部异步 open 失败会触发 'error' 事件；提前订阅避免 unhandled error，
	// 真实错误仍由下方 for-await 抛出，被外层 try/catch 收口。
	input.on('error', () => {})
	const lines = createInterface({ input, crlfDelay: Infinity })
	try {
		for await (const line of lines) {
			const trimmed = String(line).trim()
			if (!trimmed) continue
			try {
				yield sanitize(JSON.parse(trimmed))
			}
			catch { /* skip bad line */ }
		}
	}
	catch (error) {
		if (error?.code !== 'ENOENT') throw error
	}
}

/**
 * 流式过滤重写 JSONL：保留 `keep(row)===true` 的行。
 * @param {string} filePath 目标路径
 * @param {(row: object) => boolean} keep 保留谓词
 * @param {{ sanitize?: (row: object) => object }} [options] 读行净化
 * @returns {Promise<{ kept: number, dropped: number }>} 统计
 */
export async function rewriteJsonlKeeping(filePath, keep, options = {}) {
	const dir = dirname(filePath)
	await mkdir(dir, { recursive: true })
	const tmp = atomicTmpPath(filePath)
	/** @type {object[]} */
	const buffer = []
	let kept = 0
	let dropped = 0
	/** @returns {Promise<void>} */
	const flush = async () => {
		if (!buffer.length) return
		let block = ''
		for (const row of buffer)
			block += `${JSON.stringify(row)}\n`
		await appendFile(tmp, block, 'utf8')
		buffer.length = 0
	}
	try {
		for await (const row of readJsonlStream(filePath, options))
			if (keep(row)) {
				buffer.push(row)
				kept++
				if (buffer.length >= WRITE_JSONL_CHUNK_LINES)
					await flush()
			}
			else dropped++
		await flush()
	}
	catch { /* source missing */ }
	if (kept > 0 || dropped > 0)
		try {
			await rename(tmp, filePath)
		}
		catch (err) {
			// 目录已被清理（测试 cleanup 竞态 / 删群路径），清理残余 tmp 文件后静默退出。
			try { await unlink(tmp) } catch { /* ok */ }
			if (err?.code !== 'ENOENT') throw err
		}
	else
		try { await writeFile(filePath, '', 'utf8') }
		catch { /* ok */ }

	return { kept, dropped }
}

/**
 * 读取 JSONL 末行事件的 `id`（DAG tip）；空文件为 null。
 * @param {string} filePath 文件路径
 * @returns {Promise<string | null>} tip event id
 */
export async function readJsonlTipId(filePath) {
	try {
		const fh = await open(filePath, 'r')
		try {
			const { size } = await fh.stat()
			if (!size) return null
			const chunk = Math.min(size, 65_536)
			const buf = Buffer.alloc(chunk)
			await fh.read(buf, 0, chunk, size - chunk)
			const lines = buf.toString('utf8').split('\n').filter(Boolean)
			const last = lines[lines.length - 1]
			if (!last) return null
			const row = JSON.parse(last)
			return row?.id != null ? String(row.id) : null
		}
		finally {
			await fh.close()
		}
	}
	catch {
		return null
	}
}

/**
 * 将单个 JSON 对象作为一行追加写入 JSONL（必要时创建父目录）。
 * @param {string} filePath 目标文件路径
 * @param {object} record 要序列化写入的对象
 * @returns {Promise<void>}
 */
export async function appendJsonl(filePath, record) {
	await mkdir(dirname(filePath), { recursive: true })
	await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8')
}

/**
 * 流式重写 JSONL（临时文件 + rename），避免大数组 join 的内存峰值。
 * @param {string} filePath 目标路径
 * @param {object[]} records 行对象列表
 * @returns {Promise<void>}
 */
export async function writeJsonl(filePath, records) {
	const dir = dirname(filePath)
	await mkdir(dir, { recursive: true })
	const tmp = atomicTmpPath(filePath)
	/** @returns {Generator<string>} JSONL 行 */
	function* lines() {
		for (const rec of records)
			yield `${JSON.stringify(rec)}\n`
	}
	await pipeline(Readable.from(lines()), createWriteStream(tmp, { encoding: 'utf8' }))
	await rename(tmp, filePath)
}

/**
 * @param {string} filePath JSONL 路径
 * @returns {string} 进程内互斥键
 */
export function jsonlMutexKey(filePath) {
	return `jsonl:${filePath}`
}

/**
 * 在 per-file 互斥锁内流式重写 JSONL（Social / Mailbox 等非 Chat 群锁域）。
 * @param {string} filePath 目标路径
 * @param {object[]} records 行对象列表
 * @returns {Promise<void>}
 */
export async function writeJsonlSynced(filePath, records) {
	return withAsyncMutex(jsonlMutexKey(filePath), () => writeJsonl(filePath, records))
}

/**
 * 在 per-file 互斥锁内过滤重写 JSONL。
 * @param {string} filePath 目标路径
 * @param {(row: object) => boolean} keep 保留谓词
 * @param {{ sanitize?: (row: object) => object }} [options] 读行净化
 * @returns {Promise<{ kept: number, dropped: number }>} 统计
 */
export async function rewriteJsonlKeepingSynced(filePath, keep, options = {}) {
	return withAsyncMutex(jsonlMutexKey(filePath), () => rewriteJsonlKeeping(filePath, keep, options))
}

/**
 * 追加一行 JSONL 并 `fsync`。
 * @param {string} filePath 目标路径
 * @param {object} record 记录对象
 * @returns {Promise<void>}
 */
export async function appendJsonlSynced(filePath, record) {
	await mkdir(dirname(filePath), { recursive: true })
	const fh = await open(filePath, 'a')
	try {
		await fh.appendFile(`${JSON.stringify(record)}\n`, 'utf8')
		await fh.sync()
	}
	finally {
		await fh.close()
	}
}

/**
 * 原子写入 JSON 文件（临时文件 + rename）。
 * @param {string} filePath 目标路径
 * @param {object} obj 可 JSON 序列化对象
 * @returns {Promise<void>}
 */
export async function writeJsonAtomic(filePath, obj) {
	const dir = dirname(filePath)
	await mkdir(dir, { recursive: true })
	const tmp = atomicTmpPath(filePath)
	await writeFile(tmp, JSON.stringify(obj, null, '\t'), 'utf8')
	await rename(tmp, filePath)
}

/**
 * 原子写入 JSON 并对目标文件 `fsync`。
 * @param {string} filePath 目标路径
 * @param {object} obj 可序列化对象
 * @returns {Promise<void>}
 */
export async function writeJsonAtomicSynced(filePath, obj) {
	const dir = dirname(filePath)
	await mkdir(dir, { recursive: true })
	const tmp = atomicTmpPath(filePath)
	await writeFile(tmp, JSON.stringify(obj, null, '\t'), 'utf8')
	const fh = await open(tmp, 'r+')
	try {
		await fh.sync()
	}
	finally {
		await fh.close()
	}
	await rename(tmp, filePath)
	const outFh = await open(filePath, 'r+')
	try {
		await outFh.sync()
	}
	finally {
		await outFh.close()
	}
}
