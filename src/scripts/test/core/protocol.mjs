/**
 * fount 测试 suite runner 统一环境变量协议。
 *
 * 所有 manifest `run` 目标须支持：
 *
 *   FOUNT_TEST_ONLY          — 换行分隔的仓库相对路径；省略则跑 suite 默认全集
 *   FOUNT_TEST_FAILURES_OUT  — 失败时写入 JSON 数组 string[]（仓库相对路径）
 *   FOUNT_TEST_KEEP_GOING    — `1` 时失败后继续并汇总
 *   FOUNT_TEST_SCOPE         — Playwright 产物 scope（manifest id）
 */
import { readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import process from 'node:process'

/**
 * 将路径规范为仓库相对路径（正斜杠）。
 * @param {string} repoRoot 仓库根
 * @param {string} file 绝对或相对路径
 * @returns {string} 仓库相对路径
 */
export function toRepoRelative(repoRoot, file) {
	const root = resolve(repoRoot)
	const abs = resolve(root, file)
	const rel = relative(root, abs).replace(/\\/g, '/')
	if (rel.startsWith('..'))
		throw new Error(`path outside repo: ${file}`)
	return rel
}

/**
 * 解析 FOUNT_TEST_ONLY 为仓库相对路径列表。
 * @returns {string[]} 过滤路径列表
 */
export function parseTestOnlyEnv() {
	return process.env.FOUNT_TEST_ONLY?.split('\n').map(s => s.trim().replace(/\\/g, '/')).filter(Boolean) ?? []
}

/**
 * 路径是否匹配 FOUNT_TEST_ONLY 项（完整路径或后缀匹配）。
 * @param {string} repoRelative 仓库相对路径
 * @param {string} only 过滤项
 * @returns {boolean} 是否匹配
 */
export function matchesTestOnly(repoRelative, only) {
	const path = repoRelative.replace(/\\/g, '/')
	const item = only.replace(/\\/g, '/')
	return path === item || path.endsWith(`/${item}`) || path.split('/').pop() === item
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
		if (Array.isArray(data)) return data.map(String)
	}
	catch (error) {
		if (error?.code === 'ENOENT') return []
		throw error
	}
	return []
}
