/**
 * 从 Playwright JSON reporter 输出提取失败 spec 路径。
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { toRepoRelative } from '../core/protocol.mjs'

/**
 * 遍历 JSON report suite 树，收集 ok === false 的 spec 文件。
 * @param {object[]} suites report.suites
 * @param {string} rootDir Playwright config.rootDir（绝对路径）
 * @param {string} repoRoot 仓库根
 * @param {Set<string>} out 输出集合
 * @returns {void}
 */
function walkSuites(suites, rootDir, repoRoot, out) {
	for (const suite of suites ?? []) {
		for (const spec of suite.specs ?? []) {
			if (spec.ok !== false) continue
			const rel = spec.file || suite.file
			if (!rel) continue
			out.add(toRepoRelative(repoRoot, resolve(rootDir, rel)))
		}
		walkSuites(suite.suites, rootDir, repoRoot, out)
	}
}

/**
 * 读取 Playwright JSON report 并返回失败 spec 的仓库相对路径。
 * @param {string} reportPath JSON report 绝对路径
 * @param {string} repoRoot 仓库根
 * @returns {Promise<string[]>} 失败 spec 路径（排序、去重）
 */
export async function failedSpecPathsFromJsonReport(reportPath, repoRoot) {
	let raw
	try {
		raw = await readFile(reportPath, 'utf8')
	}
	catch (error) {
		if (error?.code === 'ENOENT') return []
		throw error
	}

	const report = JSON.parse(raw)
	const rootDir = report.config?.rootDir
	if (!rootDir || !report.suites?.length) return []

	const failed = new Set()
	walkSuites(report.suites, rootDir, repoRoot, failed)
	return [...failed].sort()
}
