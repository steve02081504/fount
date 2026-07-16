/**
 * fount 测试 suite runner 统一环境变量协议。
 *
 * 所有 manifest `run` 目标须支持：
 *
 *   FOUNT_TEST_ONLY          — 换行分隔的仓库相对路径；省略则跑 suite 默认全集（范围过滤）
 *   FOUNT_TEST_FIRST         — 换行分隔的仓库相对路径；这些先跑，失败组有复现则跑完失败组即退
 *   FOUNT_TEST_SUBTESTS      — 换行分隔的子测试名；省略则跑 suite 全部已注册子测试
 *   FOUNT_TEST_FAILURES_OUT  — 失败时写入 JSON 数组 string[]（仓库相对路径）
 *   FOUNT_TEST_TIMINGS_OUT   — 可选；写入 JSON 对象 Record<path, ms>（仓库相对 spec → 耗时）
 *   FOUNT_TEST_KEEP_GOING    — `1` 时失败后继续并汇总（失败组复现时仍中止）
 *   FOUNT_TEST_SCOPE         — Playwright 产物 scope（manifest id）
 */
import { realpathSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'
import process from 'node:process'

/**
 * 安全解析 symlink（路径不存在时原样返回）。
 * @param {string} p 待解析路径
 * @returns {string} 真实路径
 */
function tryRealpath(p) {
	try { return realpathSync(p) }
	catch {
		try { return resolve(realpathSync(dirname(p)), basename(p)) }
		catch { return resolve(p) }
	}
}

/**
 * 将路径规范为仓库相对路径（正斜杠）。
 * @param {string} repoRoot 仓库根
 * @param {string} file 绝对或相对路径
 * @returns {string} 仓库相对路径
 */
export function toRepoRelative(repoRoot, file) {
	const root = tryRealpath(resolve(repoRoot))
	const abs = tryRealpath(resolve(root, file))
	const rel = relative(root, abs).replace(/\\/g, '/')
	if (rel.startsWith('..'))
		throw new Error(`path outside repo: ${file}`)
	return rel
}

/**
 * 解析换行分隔的环境变量列表。
 * @param {string | undefined} raw 原始环境变量
 * @returns {string[]} 规范化路径/名称列表
 */
function parseNewlineList(raw) {
	return raw?.split('\n').map(s => s.trim().replace(/\\/g, '/')).filter(Boolean) ?? []
}

/**
 * 解析 FOUNT_TEST_ONLY 为仓库相对路径列表。
 * @returns {string[]} 过滤路径列表
 */
export function parseTestOnlyEnv() {
	return parseNewlineList(process.env.FOUNT_TEST_ONLY)
}

/**
 * 解析 FOUNT_TEST_FIRST 为仓库相对路径列表。
 * @returns {string[]} 优先路径列表
 */
export function parseTestFirstEnv() {
	return parseNewlineList(process.env.FOUNT_TEST_FIRST)
}

/**
 * 解析 FOUNT_TEST_SUBTESTS 为子测试名列表。
 * @returns {string[]} 子测试名
 */
export function parseTestSubtestsEnv() {
	return parseNewlineList(process.env.FOUNT_TEST_SUBTESTS)
}

/**
 * 路径是否匹配 FOUNT_TEST_ONLY 项（仓库相对完整路径）。
 * @param {string} repoRelative 仓库相对路径
 * @param {string} only 过滤项
 * @returns {boolean} 是否匹配
 */
export function matchesTestOnly(repoRelative, only) {
	return repoRelative.replace(/\\/g, '/') === only.replace(/\\/g, '/')
}

/**
 * 判断路径是否落在 FOUNT_TEST_ONLY 过滤范围内。
 * @param {string} repoRoot 仓库根
 * @param {string} repoRelative 待测路径
 * @param {string[]} onlyList 过滤列表
 * @returns {boolean} 是否包含
 */
export function isIncludedInTestOnly(repoRoot, repoRelative, onlyList) {
	if (!onlyList.length) return true
	const rel = toRepoRelative(repoRoot, repoRelative)
	return onlyList.some(item => matchesTestOnly(rel, item))
}

/**
 * 将失败项排到列表前面，其余保持原相对顺序。
 * @template T
 * @param {T[]} items 完整列表
 * @param {string[]} firstList 优先项（与 keyOf 结果比较）
 * @param {(item: T) => string} [keyOf] 提取比较键；默认 String
 * @returns {{ first: T[], rest: T[], ordered: T[] }} 分组与合并结果
 */
export function orderFailedFirst(items, firstList, keyOf = String) {
	if (!firstList.length)
		return { first: [], rest: [...items], ordered: [...items] }
	const firstSet = new Set(firstList.map(s => s.replace(/\\/g, '/')))
	/** @type {T[]} */
	const first = []
	/** @type {T[]} */
	const rest = []
	for (const item of items) {
		const key = keyOf(item).replace(/\\/g, '/')
		if (firstSet.has(key)) first.push(item)
		else rest.push(item)
	}
	return { first, rest, ordered: [...first, ...rest] }
}

/**
 * 异步写入失败文件列表。
 * @param {string} outPath 输出 JSON 路径
 * @param {string[]} failed 仓库相对路径
 * @returns {Promise<void>} 无返回值
 */
export async function writeFailuresOutFile(outPath, failed) {
	if (!outPath || !failed.length) return
	const unique = [...new Set(failed.map(f => f.replace(/\\/g, '/')))].sort()
	await writeFile(outPath, `${JSON.stringify(unique)}\n`, 'utf8')
}

/**
 * 读取子进程写入的失败文件列表。
 * @param {string} path JSON 路径
 * @returns {Promise<string[]>} 失败路径列表
 */
export async function readFailuresOutFile(path) {
	try {
		const raw = await readFile(path, 'utf8')
		const data = JSON.parse(raw)
		if (!Array.isArray(data))
			throw new Error(`failures out file must be JSON array: ${path}`)
		return data.map(String)
	}
	catch (error) {
		if (error?.code === 'ENOENT') return []
		throw error
	}
}

/**
 * 异步写入 per-spec 耗时表。
 * @param {string} outPath 输出 JSON 路径
 * @param {Record<string, number>} timings 仓库相对路径 → 毫秒
 * @returns {Promise<void>}
 */
export async function writeTimingsOutFile(outPath, timings) {
	if (!outPath || !timings || !Object.keys(timings).length) return
	/** @type {Record<string, number>} */
	const normalized = {}
	for (const [path, ms] of Object.entries(timings)) {
		if (ms == null || !Number.isFinite(ms) || ms < 0) continue
		normalized[path.replace(/\\/g, '/')] = ms
	}
	if (!Object.keys(normalized).length) return
	await writeFile(outPath, `${JSON.stringify(normalized)}\n`, 'utf8')
}

/**
 * 读取子进程写入的 per-spec 耗时表。
 * @param {string} path JSON 路径
 * @returns {Promise<Record<string, number>>} 仓库相对路径 → 毫秒
 */
export async function readTimingsOutFile(path) {
	try {
		const raw = await readFile(path, 'utf8')
		const data = JSON.parse(raw)
		if (!data || typeof data !== 'object' || Array.isArray(data))
			throw new Error(`timings out file must be JSON object: ${path}`)
		/** @type {Record<string, number>} */
		const out = {}
		for (const [key, value] of Object.entries(data)) {
			const ms = Number(value)
			if (!Number.isFinite(ms) || ms < 0) continue
			out[String(key).replace(/\\/g, '/')] = ms
		}
		return out
	}
	catch (error) {
		if (error?.code === 'ENOENT') return {}
		throw error
	}
}
