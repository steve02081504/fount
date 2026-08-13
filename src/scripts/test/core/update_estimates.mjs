/**
 * 按现状库 EMA 基线回写各 test/manifest.json 的 `expected`。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { formatExpected, roundExpectedMs } from './expected.mjs'
import { suiteKey } from './state.mjs'

/**
 * @typedef {import('./manifest.mjs').SuiteDef} SuiteDef
 * @typedef {import('./state.mjs').TestState} TestState
 * @typedef {import('./state.mjs').SuiteStateEntry} SuiteStateEntry
 */

/**
 * 在对象中于指定键后写入字段；已有则就地替换。
 * @param {Record<string, unknown>} obj 目标对象
 * @param {string} afterKey 锚点键
 * @param {string} field 字段名
 * @param {unknown} value 新值
 * @returns {boolean} 是否改动
 */
function setFieldAfter(obj, afterKey, field, value) {
	if (Object.hasOwn(obj, field)) {
		if (obj[field] === value) return false
		obj[field] = value
		return true
	}
	const next = {}
	let inserted = false
	for (const [key, current] of Object.entries(obj)) {
		next[key] = current
		if (key === afterKey && !inserted) {
			next[field] = value
			inserted = true
		}
	}
	if (!inserted) next[field] = value
	for (const key of Object.keys(obj)) delete obj[key]
	Object.assign(obj, next)
	return true
}

/**
 * 由现状条目抽出可写入的 expected 字面量。
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状
 * @returns {{ expected?: string | number, subtests: Record<string, string | number> } | null} 补丁；无任何基线则 null
 */
function estimatePatchFromState(suite, entry) {
	if (!entry) return null
	const suiteMs = roundExpectedMs(
		entry.baselineDurationMs
		?? (suite.subtests?.length ? null : entry.durationMs),
	)
	/** @type {Record<string, string | number>} */
	const subtests = {}
	for (const subtest of suite.subtests ?? []) {
		const formatted = formatExpected(entry.subtests?.[subtest.name]?.durationMs)
		if (formatted != null) subtests[subtest.name] = formatted
	}
	const expected = formatExpected(suiteMs)
	if (expected == null && !Object.keys(subtests).length) return null
	return { ...expected != null ? { expected } : {}, subtests }
}

/**
 * 将补丁写进 manifest 里的 suite 对象。
 * @param {object} jsonSuite manifest.suites[] 条目
 * @param {{ expected?: string | number, subtests: Record<string, string | number> }} patch 补丁
 * @returns {boolean} 是否改动
 */
function applyEstimatePatch(jsonSuite, patch) {
	let changed = false
	if (patch.expected != null)
		changed = setFieldAfter(jsonSuite, 'name', 'expected', patch.expected) || changed
	if (!Object.keys(patch.subtests).length) return changed
	for (const raw of jsonSuite.subtests ?? []) {
		const value = patch.subtests[raw.name]
		if (value == null) continue
		changed = setFieldAfter(raw, 'name', 'expected', value) || changed
	}
	return changed
}

/**
 * 按现状库回写所选 suite 所在 manifest 的 `expected`。
 * @param {object} params 参数
 * @param {string} params.repoRoot 仓库根
 * @param {SuiteDef[]} params.suites 要更新的 suite
 * @param {TestState} params.state 现状库
 * @returns {Promise<{ filesChanged: number, suitesUpdated: number, skipped: number }>} 摘要
 */
export async function updateManifestEstimates({ repoRoot, suites, state }) {
	/** @type {Map<string, SuiteDef[]>} */
	const byPath = new Map()
	for (const suite of suites) {
		if (!suite.manifestPath) continue
		const list = byPath.get(suite.manifestPath) ?? []
		list.push(suite)
		byPath.set(suite.manifestPath, list)
	}

	let filesChanged = 0
	let suitesUpdated = 0
	let skipped = 0

	for (const [relPath, group] of byPath) {
		const abs = join(repoRoot, relPath)
		const raw = await readFile(abs, 'utf8')
		const manifest = JSON.parse(raw)
		let fileChanged = false
		for (const suite of group) {
			const jsonSuite = manifest.suites?.find(entry => entry.name === suite.name)
			if (!jsonSuite) {
				skipped++
				continue
			}
			const patch = estimatePatchFromState(suite, state.suites[suiteKey(suite.manifestId, suite.name)])
			if (!patch) {
				skipped++
				continue
			}
			if (applyEstimatePatch(jsonSuite, patch)) {
				fileChanged = true
				suitesUpdated++
			}
			else
				skipped++
		}
		if (!fileChanged) continue
		const next = `${JSON.stringify(manifest, null, '\t')}\n`
		if (next === raw) continue
		await writeFile(abs, next, 'utf8')
		filesChanged++
	}

	return { filesChanged, suitesUpdated, skipped }
}
