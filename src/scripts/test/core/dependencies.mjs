/**
 * 测试 suite 依赖解析与拓扑排序。
 */
import { filterSuites } from './manifest.mjs'
import { parseDependsOnEntry } from './selector.mjs'
import { suiteKey } from './state.mjs'

/**
 * @typedef {import('./manifest.mjs').SuiteDef} SuiteDef
 * @typedef {{ manifestId: string, name: string }} SuiteRef
 */

/**
 * 解析单个 suite 的 dependsOn 为具体引用列表。
 * @param {SuiteDef} suite suite
 * @param {SuiteDef[]} allSuites 全部 suite
 * @returns {SuiteRef[]} 依赖引用
 */
export function resolveSuiteDependencies(suite, allSuites) {
	if (!suite.dependsOn?.length) return []

	const knownManifestIds = [...new Set(allSuites.map(s => s.manifestId))]
	const refs = new Map()
	for (const raw of suite.dependsOn) {
		const parsed = parseDependsOnEntry(raw, suite.manifestId, knownManifestIds)
		const matched = filterSuites(allSuites, {
			manifestIds: parsed.manifestSelectors,
			suiteSelectors: parsed.suiteSelectors.length ? parsed.suiteSelectors : undefined,
		}, { prefixExpand: false })
		if (!matched.length)
			throw new Error(`dependsOn "${raw}" in ${suite.manifestId}:${suite.name} matched no suites`)
		for (const dep of matched)
			refs.set(suiteKey(dep.manifestId, dep.name), { manifestId: dep.manifestId, name: dep.name })
	}
	return [...refs.values()]
}

/**
 * 为全部 suite 解析并挂载 dependencies 字段。
 * @param {SuiteDef[]} allSuites 全部 suite
 * @returns {SuiteDef[]} 带 dependencies 的 suite
 */
export function attachDependencies(allSuites) {
	for (const suite of allSuites)
		suite.dependencies = resolveSuiteDependencies(suite, allSuites)
	return allSuites
}

/**
 * 检测依赖环。
 * @param {SuiteDef[]} suites 参与排序的 suite
 * @returns {string | null} 环路径描述；无环时为 null
 */
export function detectDependencyCycle(suites) {
	const byKey = new Map(suites.map(s => [suiteKey(s.manifestId, s.name), s]))
	/** @type {Set<string>} */
	const visiting = new Set()
	/** @type {Set<string>} */
	const visited = new Set()

	/**
	 * @param {string} key suite 键
	 * @param {string[]} stack 当前路径
	 * @returns {string | null} 环路径；无环时为 null
	 */
	function dfs(key, stack) {
		if (visiting.has(key))
			return [...stack, key].join(' -> ')
		if (visited.has(key)) return null
		visiting.add(key)
		const suite = byKey.get(key)
		for (const dep of suite?.dependencies ?? []) {
			const depKey = suiteKey(dep.manifestId, dep.name)
			const cycle = dfs(depKey, [...stack, key])
			if (cycle) return cycle
		}
		visiting.delete(key)
		visited.add(key)
		return null
	}

	for (const key of byKey.keys()) {
		const cycle = dfs(key, [])
		if (cycle) return cycle
	}
	return null
}

/**
 * Kahn 拓扑排序；并列时由 compareTieBreak 决定先后。
 * @param {string[]} keys 待排序键
 * @param {Map<string, Set<string>>} dependencyEdges 键 -> 直接依赖键（仅 subset 内边）
 * @param {(a: string, b: string) => number} compareTieBreak 无依赖边时的比较
 * @returns {string[]} 排序后的键
 */
function topoSortKeys(keys, dependencyEdges, compareTieBreak) {
	const unique = [...new Set(keys)]
	if (unique.length <= 1) return unique

	const keySet = new Set(unique)
	/** @type {Map<string, number>} */
	const inDegree = new Map(unique.map(k => [k, 0]))
	/** @type {Map<string, Set<string>>} */
	const adj = new Map(unique.map(k => [k, new Set()]))
	for (const key of unique)
		for (const dep of dependencyEdges.get(key) ?? []) {
			if (!keySet.has(dep)) continue
			adj.get(dep).add(key)
			inDegree.set(key, inDegree.get(key) + 1)
		}

	/** @type {string[]} */
	const ready = unique.filter(k => inDegree.get(k) === 0)
	/** @type {string[]} */
	const sorted = []

	while (ready.length) {
		ready.sort(compareTieBreak)
		const next = ready.shift()
		sorted.push(next)
		for (const dependent of adj.get(next) ?? []) {
			inDegree.set(dependent, inDegree.get(dependent) - 1)
			if (inDegree.get(dependent) === 0)
				ready.push(dependent)
		}
	}

	if (sorted.length < unique.length)
		throw new Error(`dependency cycle among: ${unique.filter(k => !sorted.includes(k)).join(', ')}`)

	return sorted
}

/**
 * 拓扑并列 tie-break：被依赖数少→前、依赖数少→前、`/` 少→前、字符串短→前、字典序。
 * @param {string} a suite 键 A
 * @param {string} b suite 键 B
 * @param {Map<string, number>} dependentCount 被依赖计数
 * @param {Map<string, number>} depCount 依赖计数
 * @returns {number} 比较结果（负数表示 a 在前）
 */
function compareTopoTieBreak(a, b, dependentCount, depCount) {
	const depByA = dependentCount.get(a) ?? 0
	const depByB = dependentCount.get(b) ?? 0
	if (depByA !== depByB) return depByA - depByB
	const depA = depCount.get(a) ?? 0
	const depB = depCount.get(b) ?? 0
	if (depA !== depB) return depA - depB
	const slashA = (a.match(/\//g) ?? []).length
	const slashB = (b.match(/\//g) ?? []).length
	if (slashA !== slashB) return slashA - slashB
	if (a.length !== b.length) return a.length - b.length
	return a.localeCompare(b)
}

/**
 * 统计全库 suite 的依赖/被依赖边数（tie-break 用）。
 * @param {import('./manifest.mjs').SuiteDef[]} allSuites 全部 suite
 * @returns {{ depCount: Map<string, number>, dependentCount: Map<string, number> }} 出度与入度计数
 */
function buildSuiteMetrics(allSuites) {
	/** @type {Map<string, number>} */
	const depCount = new Map()
	/** @type {Map<string, number>} */
	const dependentCount = new Map()
	/** @type {Map<string, Set<string>>} */
	const seen = new Map()

	for (const suite of allSuites) {
		const from = suiteKey(suite.manifestId, suite.name)
		depCount.set(from, depCount.get(from) ?? 0)
		dependentCount.set(from, dependentCount.get(from) ?? 0)
		const edges = seen.get(from) ?? new Set()
		for (const dep of suite.dependencies ?? []) {
			const to = suiteKey(dep.manifestId, dep.name)
			if (edges.has(to)) continue
			edges.add(to)
			depCount.set(from, (depCount.get(from) ?? 0) + 1)
			dependentCount.set(to, (dependentCount.get(to) ?? 0) + 1)
		}
		seen.set(from, edges)
	}
	return { depCount, dependentCount }
}

/**
 * 构建 suite 依赖邻接表（值为依赖方 suite 键集合）。
 * @param {import('./manifest.mjs').SuiteDef[]} suites 参与构图的 suite
 * @returns {Map<string, Set<string>>} suite 键 → 其 dependsOn 键集合
 */
function buildSuiteDependencyEdges(suites) {
	return new Map(suites.map(suite => [
		suiteKey(suite.manifestId, suite.name),
		new Set((suite.dependencies ?? []).map(dep => suiteKey(dep.manifestId, dep.name))),
	]))
}

/**
 * suite 排序：依赖在前。
 * @param {SuiteDef[]} suites 待排序 suite
 * @param {SuiteDef[]} [allSuites] 全库 suite（tie-break 计数范围；默认同 suites）
 * @returns {SuiteDef[]} 排序结果
 */
export function topoSortSuites(suites, allSuites = suites) {
	if (suites.length <= 1) return [...suites]

	const byKey = new Map(suites.map(s => [suiteKey(s.manifestId, s.name), s]))
	const { depCount, dependentCount } = buildSuiteMetrics(allSuites)
	const dependencyEdges = buildSuiteDependencyEdges(suites)

	const sortedKeys = topoSortKeys(
		[...byKey.keys()],
		dependencyEdges,
		(a, b) => compareTopoTieBreak(a, b, dependentCount, depCount),
	)
	return sortedKeys.map(key => byKey.get(key))
}

/**
 * 构建 manifest 级依赖图（跨 manifest dependsOn 边）。
 * @param {import('./manifest.mjs').SuiteDef[]} suites 参与构图的 suite
 * @returns {Map<string, Set<string>>} manifest id → 其依赖 manifest id 集合
 */
function buildManifestGraph(suites) {
	const ids = [...new Set(suites.map(s => s.manifestId))]
	/** @type {Map<string, number>} */
	const depCount = new Map(ids.map(id => [id, 0]))
	/** @type {Map<string, number>} */
	const dependentCount = new Map(ids.map(id => [id, 0]))
	/** @type {Map<string, Set<string>>} */
	const dependencyEdges = new Map(ids.map(id => [id, new Set()]))

	for (const suite of suites)
		for (const dep of suite.dependencies ?? []) {
			if (dep.manifestId === suite.manifestId) continue
			const from = suite.manifestId
			const to = dep.manifestId
			if (dependencyEdges.get(from).has(to)) continue
			dependencyEdges.get(from).add(to)
			depCount.set(from, depCount.get(from) + 1)
			dependentCount.set(to, dependentCount.get(to) + 1)
		}

	return { depCount, dependentCount, dependencyEdges }
}

/**
 * manifest id 排序：被依赖者在前。
 * @param {string[]} manifestIds 待排序 id
 * @param {SuiteDef[]} suites 全部 suite
 * @returns {string[]} 排序结果
 */
export function sortManifestIds(manifestIds, suites) {
	const unique = [...new Set(manifestIds)]
	if (unique.length <= 1) return unique

	const { depCount, dependentCount, dependencyEdges } = buildManifestGraph(suites)

	return topoSortKeys(
		unique,
		dependencyEdges,
		(a, b) => compareTopoTieBreak(a, b, dependentCount, depCount),
	)
}

/**
 * imperfect 命中的 suite 的直接下游（一层）。
 * @param {Set<string>} imperfectKeys imperfect 键
 * @param {SuiteDef[]} allSuites 全部 suite
 * @returns {Set<string>} 扩展后的键集
 */
export function expandImperfectDependents(imperfectKeys, allSuites) {
	const expanded = new Set(imperfectKeys)
	for (const suite of allSuites) {
		const key = suiteKey(suite.manifestId, suite.name)
		if (expanded.has(key)) continue
		if (suite.dependencies?.some(dep => imperfectKeys.has(suiteKey(dep.manifestId, dep.name))))
			expanded.add(key)
	}
	return expanded
}
