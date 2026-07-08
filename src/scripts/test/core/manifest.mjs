/**
 * 扫描仓库内全部 test/manifest.json 并解析 suite 元数据。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { attachDependencies, sortManifestIds } from './deps.mjs'
import { matchGlob } from './glob.mjs'
import { parseManifestResources } from './resources.mjs'
import { filterTriggerRelevantFiles, mergeTriggerFilter } from './trigger_filter.mjs'
/**
 * manifest 中单个 suite 的解析结果。
 * @typedef {object} SuiteDef
 * @property {string} manifestId manifest 顶层 id
 * @property {string} name suite 显示名
 * @property {string} id suite 指名 id（默认同 name）
 * @property {string[]} run 执行命令
 * @property {string[]} triggers 触发 glob
 * @property {string} manifestPath 相对仓库根的 manifest 路径
 * @property {boolean} heavy 满核独占（仅 `p2p/sim` 等）；其余用 `resources`
 * @property {{ memMb?: number, cpuPct?: number } | undefined} resources 声明资源；缺省由 `resources.mjs` 推断
 * @property {string[]} [dependsOn] manifest 中的依赖指名
 * @property {{ manifestId: string, name: string }[]} [dependencies] 解析后的依赖
 * @property {import('./trigger_filter.mjs').TriggerFilter} [triggerFilter] 忽略规则覆写
 */

/**
 * 解析 suite 的 trigger 引用为 glob 模式列表。
 * @param {object} suite manifest 中的 suite 条目
 * @param {Record<string, string[]>} triggerSets manifest triggerSets
 * @returns {string[]} 解析后的 triggers
 */
function resolveSuiteTriggers(suite, triggerSets) {
	/** @type {string[]} */
	const patterns = []
	const refs = suite.trigger
		? Array.isArray(suite.trigger) ? suite.trigger : [suite.trigger]
		: []
	for (const ref of refs) {
		const set = triggerSets[ref]
		if (!set?.length)
			throw new Error(`unknown trigger "${ref}" in suite "${suite.name}"`)
		patterns.push(...set)
	}
	if (suite.triggers?.length)
		patterns.push(...suite.triggers)
	return [...new Set(patterns)]
}

const INFRA_PREFIX = 'src/scripts/test/'

const SKIP_DIR_NAMES = new Set([
	'node_modules',
	'.git',
	'dist',
])

/**
 * 递归查找 test/manifest.json。
 * @param {string} dir 当前目录绝对路径
 * @returns {AsyncGenerator<string>} manifest 绝对路径
 */
async function* findManifestFiles(dir) {
	let entries
	try {
		entries = await readdir(dir, { withFileTypes: true })
	}
	catch {
		return
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue
		if (SKIP_DIR_NAMES.has(entry.name)) continue
		const path = join(dir, entry.name)
		if (entry.name === 'test') {
			const manifestPath = join(path, 'manifest.json')
			try {
				await stat(manifestPath)
				yield manifestPath
			}
			catch { /* no manifest */ }
			continue
		}
		yield* findManifestFiles(path)
	}
}

/**
 * 读取全部 manifest 中的 suite 定义。
 * @param {string} repoRoot 仓库根目录
 * @returns {Promise<SuiteDef[]>} 全部 suite
 */
export async function loadAllSuites(repoRoot) {
	/** @type {SuiteDef[]} */
	const suites = []
	/** @type {Set<string>} */
	const seenIds = new Set()

	for await (const manifestPath of findManifestFiles(repoRoot)) {
		const raw = await readFile(manifestPath, 'utf8')
		const manifest = JSON.parse(raw)
		const manifestId = manifest.id?.trim()
		if (!manifestId) {
			const rel = relative(repoRoot, manifestPath).replace(/\\/g, '/')
			throw new Error(`test manifest missing "id": ${rel}`)
		}
		if (seenIds.has(manifestId))
			throw new Error(`duplicate test manifest id: ${manifestId}`)
		seenIds.add(manifestId)

		const relManifest = relative(repoRoot, manifestPath).replace(/\\/g, '/')
		const triggerSets = manifest.triggerSets ?? {}
		const manifestTriggerFilter = manifest.triggerFilter
		for (const suite of manifest.suites || []) {
			if (!suite.name)
				throw new Error(`suite missing "name" in ${relManifest}`)
			suites.push({
				manifestId,
				name: suite.name,
				id: suite.id?.trim() || suite.name,
				run: suite.run,
				triggers: resolveSuiteTriggers(suite, triggerSets),
				manifestPath: relManifest,
				heavy: suite.heavy === true,
				resources: parseManifestResources(suite.resources),
				dependsOn: suite.dependsOn
					? Array.isArray(suite.dependsOn) ? suite.dependsOn : [suite.dependsOn]
					: undefined,
				triggerFilter: mergeTriggerFilter(manifestTriggerFilter, suite.triggerFilter),
			})
		}
	}
	return attachDependencies(suites)
}

/**
 * 按变更文件与 manifest triggers 选出 suite。
 * @param {'all' | 'diff' | 'none'} mode 变更模式
 * @param {string[]} files 变更文件列表
 * @param {SuiteDef[]} allSuites 全部 suite
 * @returns {SuiteDef[]} 待执行 suite
 */
export function selectSuitesByDiff(mode, files, allSuites) {
	if (mode === 'all')
		return allSuites

	if (!files.length) return []

	const infraHit = filterTriggerRelevantFiles(files).some(f =>
		f.startsWith(INFRA_PREFIX)
		|| f.startsWith('.github/workflows/verify_shells.'),
	)
	if (infraHit) return allSuites

	/** @type {SuiteDef[]} */
	const selected = []
	for (const suite of allSuites) {
		const relevant = filterTriggerRelevantFiles(files, suite.triggerFilter)
		if (!relevant.length) continue
		const hit = suite.triggers.some(pat => relevant.some(f => matchGlob(pat, f)))
		if (hit) selected.push(suite)
	}
	return selected
}

/**
 * suite 是否匹配指名 selector（id 或 name；支持 glob 与前缀展开）。
 * @param {SuiteDef} suite suite
 * @param {string} selector 指名
 * @param {{ prefixExpand?: boolean }} [options] prefixExpand 为 false 时仅精确匹配与显式 glob
 * @returns {boolean} 是否匹配
 */
export function suiteMatchesSelector(suite, selector, { prefixExpand = true } = {}) {
	const sel = selector.trim()
	if (!sel) return false

	const fields = [suite.id, suite.name]
	if (fields.some(field => field === sel)) return true

	/** @type {string[]} */
	const patterns = []
	if (sel.includes('*') || sel.includes('?'))
		patterns.push(sel)
	else if (prefixExpand)
		patterns.push(`${sel}*`, `${sel}_*`)

	return patterns.some(pat => fields.some(field => matchGlob(pat, field)))
}

/**
 * 按 manifest id 与 suite selector 过滤。
 * @param {SuiteDef[]} suites 候选 suite
 * @param {object} filter 过滤条件
 * @param {string[]} [filter.manifestIds] manifest id 列表
 * @param {string[]} [filter.suiteSelectors] suite id 或 name
 * @param {{ prefixExpand?: boolean }} [options] 传给 suiteMatchesSelector
 * @returns {SuiteDef[]} 过滤后的 suite
 */
export function filterSuites(suites, { manifestIds, suiteSelectors }, { prefixExpand = true } = {}) {
	let out = suites
	if (manifestIds?.length)
		out = out.filter(s => manifestIds.includes(s.manifestId))
	if (suiteSelectors?.length) {
		// 精确命中某个 suite id/name 的 selector 不再前缀展开：
		// `fed_emoji` 只选 fed_emoji，而 `fed`（无同名 suite）仍展开为 fed_* / fed_*_*。
		const expandBySelector = new Map(suiteSelectors.map(sel => {
			const trimmed = sel.trim()
			const hasExact = out.some(s => s.id === trimmed || s.name === trimmed)
			return [sel, prefixExpand && !hasExact]
		}))
		out = out.filter(s => suiteSelectors.some(sel =>
			suiteMatchesSelector(s, sel, { prefixExpand: expandBySelector.get(sel) })))
	}
	return out
}

/**
 * 列出已知 manifest id。
 * @param {SuiteDef[]} suites 全部 suite
 * @returns {string[]} 排序后的 manifest id
 */
export function listManifestIds(suites) {
	return sortManifestIds([...new Set(suites.map(s => s.manifestId))], suites)
}

/**
 * 将 CLI manifest 指名解析为具体 id 列表（精确匹配、自动 `${id}/*`、glob）。
 * @param {string[]} selectors 用户输入的指名
 * @param {string[]} knownIds 已知 manifest id
 * @param {SuiteDef[]} allSuites 全部 suite（用于依赖排序）
 * @returns {{ manifestIds: string[], unmatched: string[] }} 解析结果
 */
export function resolveManifestSelectors(selectors, knownIds, allSuites) {
	/** @type {string[]} */
	const resolved = []
	/** @type {string[]} */
	const unmatched = []

	for (const raw of selectors) {
		const selector = raw.trim()
		if (!selector) continue

		if (knownIds.includes(selector)) {
			resolved.push(selector)
			continue
		}

		/** @type {string[]} */
		const patterns = []
		if (selector.includes('*') || selector.includes('?'))
			patterns.push(selector)
		else
			patterns.push(`${selector}/*`)

		let hits = []
		for (const pattern of patterns)
			hits = hits.concat(knownIds.filter(id => matchGlob(pattern, id)))

		if (hits.length)
			resolved.push(...hits)
		else
			unmatched.push(selector)
	}

	return {
		manifestIds: sortManifestIds([...new Set(resolved)], allSuites),
		unmatched,
	}
}
