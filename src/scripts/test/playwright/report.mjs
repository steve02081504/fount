/**
 * 从 Playwright JSON reporter 输出提取失败 spec 路径与 per-spec 耗时。
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { toRepoRelative } from '../core/protocol.mjs'

/**
 * @param {object} spec Playwright JSON report spec 节点
 * @returns {number} 毫秒（各 test 结果耗时之和；无则 0）
 */
function specDurationMs(spec) {
	let total = 0
	for (const test of spec.tests ?? [])
		for (const result of test.results ?? []) {
			const ms = Number(result.duration)
			if (Number.isFinite(ms) && ms > 0) total += ms
		}
	return total
}

/**
 * 遍历 JSON report suite 树。
 * @param {object[]} suites report.suites
 * @param {string} rootDir Playwright config.rootDir（绝对路径）
 * @param {string} repoRoot 仓库根
 * @param {{ failed?: Set<string>, timings?: Map<string, number> }} collectors 收集器
 * @returns {void}
 */
function walkSuites(suites, rootDir, repoRoot, collectors) {
	for (const suite of suites ?? []) {
		for (const spec of suite.specs ?? []) {
			const rel = spec.file || suite.file
			if (!rel) continue
			const path = toRepoRelative(repoRoot, resolve(rootDir, rel))
			if (collectors.failed && spec.ok === false)
				collectors.failed.add(path)
			if (collectors.timings) {
				const ms = specDurationMs(spec)
				if (ms > 0)
					collectors.timings.set(path, (collectors.timings.get(path) ?? 0) + ms)
			}
		}
		walkSuites(suite.suites, rootDir, repoRoot, collectors)
	}
}

/**
 * @param {string} reportPath JSON report 绝对路径
 * @returns {Promise<object | null>} 解析后的 report；缺失返回 null
 */
async function readJsonReport(reportPath) {
	try {
		return JSON.parse(await readFile(reportPath, 'utf8'))
	}
	catch (error) {
		if (error?.code === 'ENOENT') return null
		throw error
	}
}

/**
 * 读取 Playwright JSON report 并返回失败 spec 的仓库相对路径。
 * @param {string} reportPath JSON report 绝对路径
 * @param {string} repoRoot 仓库根
 * @returns {Promise<string[]>} 失败 spec 路径（排序、去重）
 */
export async function failedSpecPathsFromJsonReport(reportPath, repoRoot) {
	const report = await readJsonReport(reportPath)
	const rootDir = report?.config?.rootDir
	if (!rootDir || !report.suites?.length) return []

	const failed = new Set()
	walkSuites(report.suites, rootDir, repoRoot, { failed })
	return [...failed].sort()
}

/**
 * 读取 Playwright JSON report 并返回 per-spec 耗时。
 * @param {string} reportPath JSON report 绝对路径
 * @param {string} repoRoot 仓库根
 * @returns {Promise<Record<string, number>>} 仓库相对路径 → 毫秒
 */
export async function specTimingsFromJsonReport(reportPath, repoRoot) {
	const report = await readJsonReport(reportPath)
	const rootDir = report?.config?.rootDir
	if (!rootDir || !report.suites?.length) return {}

	/** @type {Map<string, number>} */
	const timings = new Map()
	walkSuites(report.suites, rootDir, repoRoot, { timings })
	return Object.fromEntries(timings)
}
