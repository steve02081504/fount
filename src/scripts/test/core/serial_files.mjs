/**
 * serial.mjs suite 的文件级过滤：CLI `manifest:suite:stem` → FOUNT_TEST_ONLY 路径。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import { toRepoRelative } from './protocol.mjs'
import { suiteUsesSerialRunner } from './resources.mjs'

/**
 * 从 suite.run 抽出 serial.mjs 之后的目录/文件参数。
 * @param {import('./manifest.mjs').SuiteDef} suite suite
 * @param {string} repoRoot 仓库根
 * @returns {string[]} 绝对路径
 */
export function serialRunnerRoots(suite, repoRoot) {
	const idx = suite.run.findIndex(arg => String(arg).includes('serial.mjs'))
	if (idx < 0) return []
	/** @type {string[]} */
	const roots = []
	for (const arg of suite.run.slice(idx + 1)) {
		if (String(arg).startsWith('--')) continue
		roots.push(resolve(repoRoot, String(arg)))
	}
	return roots
}

/**
 * 递归收集目录下 *.test.mjs（与 serial.mjs 一致，跳过 live/frontend）。
 * @param {string} directory 绝对目录
 * @returns {string[]} 绝对路径
 */
function collectTestFiles(directory) {
	if (!existsSync(directory) || !statSync(directory).isDirectory()) return []
	/** @type {string[]} */
	const files = []
	for (const name of readdirSync(directory)) {
		const path = join(directory, name)
		if (statSync(path).isDirectory()) {
			if (name === 'live' || name === 'frontend') continue
			files.push(...collectTestFiles(path))
		}
		else if (name.endsWith('.test.mjs'))
			files.push(path)
	}
	return files
}

/**
 * @param {string} name CLI 子测试名（文件 stem，可带或不带 `.test` / `.test.mjs`）
 * @returns {string} 规范化 stem（无扩展）
 */
export function normalizeTestFileStem(name) {
	let stem = String(name || '').trim().replace(/\\/g, '/')
	stem = basename(stem)
	if (stem.endsWith('.test.mjs')) stem = stem.slice(0, -'.test.mjs'.length)
	else if (stem.endsWith('.mjs')) stem = stem.slice(0, -'.mjs'.length)
	else if (stem.endsWith('.test')) stem = stem.slice(0, -'.test'.length)
	return stem
}

/**
 * 将 CLI 文件名解析为仓库相对 *.test.mjs 路径。
 * @param {import('./manifest.mjs').SuiteDef} suite suite
 * @param {string[]} names CLI 名列表
 * @param {string} repoRoot 仓库根
 * @returns {{ files: string[], missing: string[] }} 命中与缺失
 */
export function resolveSerialOnlyFiles(suite, names, repoRoot) {
	if (!suiteUsesSerialRunner(suite) || !names?.length)
		return { files: [], missing: [...names ?? []] }

	const roots = serialRunnerRoots(suite, repoRoot)
	/** @type {string[]} */
	const pool = []
	for (const root of roots) {
		if (!existsSync(root)) continue
		const st = statSync(root)
		if (st.isDirectory()) pool.push(...collectTestFiles(root))
		else if (root.endsWith('.test.mjs')) pool.push(root)
	}

	const byStem = new Map()
	for (const abs of pool) {
		const base = basename(abs)
		const stem = base.endsWith('.test.mjs') ? base.slice(0, -'.test.mjs'.length) : base
		byStem.set(stem, abs)
	}

	/** @type {string[]} */
	const files = []
	/** @type {string[]} */
	const missing = []
	for (const raw of names) {
		const stem = normalizeTestFileStem(raw)
		const abs = byStem.get(stem)
		if (!abs) {
			missing.push(raw)
			continue
		}
		files.push(toRepoRelative(repoRoot, abs))
	}
	return { files: [...new Set(files)], missing }
}

/**
 * 校验显式子测试/文件过滤；不通过时返回错误文案（已 i18n 前的结构化信息）。
 * @param {Map<string, string[]>} subtestFilterByKey suite 键 → 名
 * @param {Map<string, import('./manifest.mjs').SuiteDef>} byKey suite 表
 * @param {string} repoRoot 仓库根
 * @returns {{ key: string, suiteId: string, missing: string[], kind: 'subtest' | 'file' | 'unsupported' }[]} 错误列表
 */
export function validateSubtestFilters(subtestFilterByKey, byKey, repoRoot) {
	/** @type {{ key: string, suiteId: string, missing: string[], kind: 'subtest' | 'file' | 'unsupported' }[]} */
	const errors = []
	for (const [key, names] of subtestFilterByKey) {
		if (!names?.length) continue
		const suite = byKey.get(key)
		if (!suite) continue
		const suiteId = suite.id || key
		if (suite.subtests?.length) {
			const known = new Set(suite.subtests.map(st => st.name))
			const missing = names.filter(name => !known.has(name))
			if (missing.length)
				errors.push({ key, suiteId, missing, kind: 'subtest' })
			continue
		}
		if (suiteUsesSerialRunner(suite)) {
			const { missing } = resolveSerialOnlyFiles(suite, names, repoRoot)
			if (missing.length)
				errors.push({ key, suiteId, missing, kind: 'file' })
			continue
		}
		errors.push({ key, suiteId, missing: names, kind: 'unsupported' })
	}
	return errors
}
