/**
 * 测试 suite 依赖解析、拓扑排序与扩展。
 */
import { filterSuites } from './manifest.mjs'
import { isDependencySatisfied, isSuiteGreen, isSuiteOutdated, suiteKey } from './state.mjs'

/**
 * @typedef {import('./manifest.mjs').SuiteDef} SuiteDef
 * @typedef {import('./state.mjs').TestState} TestState
 * @typedef {{ manifestId: string, name: string }} SuiteRef
 */

/**
 * 解析 dependsOn 条目为具体 suite 引用。
 * @param {string} raw 原始 dependsOn
 * @param {string} ownerManifestId 所属 manifest
 * @returns {{ manifestSelectors: string[], suiteSelectors: string[] }} 解析结果
 */
function parseDependsOnEntry(raw, ownerManifestId) {
	const token = raw.trim()
	if (!token) return { manifestSelectors: [], suiteSelectors: [] }
	if (token.includes(':')) {
		const colon = token.indexOf(':')
		return {
			manifestSelectors: [token.slice(0, colon)],
			suiteSelectors: token.slice(colon + 1).split(/[,\s]+/).map(s => s.trim()).filter(Boolean),
		}
	}
	return {
		manifestSelectors: [ownerManifestId],
		suiteSelectors: [token],
	}
}

/**
 * 解析单个 suite 的 dependsOn 为具体引用列表。
 * @param {SuiteDef} suite suite
 * @param {SuiteDef[]} allSuites 全部 suite
 * @returns {SuiteRef[]} 依赖引用
 */
export function resolveSuiteDependencies(suite, allSuites) {
	if (!suite.dependsOn?.length) return []

	const refs = new Map()
	for (const raw of suite.dependsOn) {
		const parsed = parseDependsOnEntry(raw, suite.manifestId)
		const matched = filterSuites(allSuites, {
			manifestIds: parsed.manifestSelectors,
			suiteSelectors: parsed.suiteSelectors,
		}, { prefixExpand: false })
		if (!matched.length)
			throw new Error(`dependsOn "${raw}" in ${suite.manifestId}/${suite.name} matched no suites`)
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
 * @param {Map<string, Set<string>>} deps 键 -> 直接依赖键（仅 subset 内边）
 * @param {(a: string, b: string) => number} compareTieBreak 无依赖边时的比较
 * @returns {string[]} 排序后的键
 */
function topoSortKeys(keys, deps, compareTieBreak) {
	const unique = [...new Set(keys)]
	if (unique.length <= 1) return unique

	const keySet = new Set(unique)
	/** @type {Map<string, number>} */
	const inDegree = new Map(unique.map(k => [k, 0]))
	/** @type {Map<string, Set<string>>} */
	const adj = new Map(unique.map(k => [k, new Set()]))
	for (const key of unique) 
		for (const dep of deps.get(key) ?? []) {
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
 * 全库 suite 依赖计数（tie-break 用）。
 * @param {SuiteDef[]} allSuites 全部 suite
 * @returns {{ depCount: Map<string, number>, dependentCount: Map<string, number> }}
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
 * subset 内 suite 直接依赖边。
 * @param {SuiteDef[]} suites 待排序 suite
 * @returns {Map<string, Set<string>>}
 */
function buildSubsetSuiteDeps(suites) {
	const byKey = new Map(suites.map(s => [suiteKey(s.manifestId, s.name), s]))
	/** @type {Map<string, Set<string>>} */
	const deps = new Map([...byKey.keys()].map(k => [k, new Set()]))
	for (const suite of suites) {
		const from = suiteKey(suite.manifestId, suite.name)
		for (const dep of suite.dependencies ?? []) {
			const to = suiteKey(dep.manifestId, dep.name)
			if (!byKey.has(to)) continue
			deps.get(from).add(to)
		}
	}
	return deps
}

/**
 * suite 排序：依赖在前；无依赖边时按被依赖数少→前、依赖数少→前、`manifestId/name` 字典序。
 * @param {SuiteDef[]} suites 待排序 suite
 * @param {SuiteDef[]} [allSuites] 全库 suite（tie-break 计数范围；默认同 suites）
 * @returns {SuiteDef[]} 排序结果
 */
export function topoSortSuites(suites, allSuites = suites) {
	if (suites.length <= 1) return [...suites]

	const byKey = new Map(suites.map(s => [suiteKey(s.manifestId, s.name), s]))
	const { depCount, dependentCount } = buildSuiteMetrics(allSuites)
	const deps = buildSubsetSuiteDeps(suites)

	/**
	 * @param {string} a suite 键
	 * @param {string} b suite 键
	 * @returns {number}
	 */
	function compareTieBreak(a, b) {
		const depByA = dependentCount.get(a) ?? 0
		const depByB = dependentCount.get(b) ?? 0
		if (depByA !== depByB) return depByA - depByB
		const depA = depCount.get(a) ?? 0
		const depB = depCount.get(b) ?? 0
		if (depA !== depB) return depA - depB
		return a.localeCompare(b)
	}

	const sortedKeys = topoSortKeys([...byKey.keys()], deps, compareTieBreak)
	return sortedKeys.map(key => byKey.get(key))
}

/**
 * 从 suite 依赖构建 manifest 级图（同 manifest 内边忽略）。
 * @param {SuiteDef[]} suites 全部 suite
 * @returns {{ depCount: Map<string, number>, dependentCount: Map<string, number>, deps: Map<string, Set<string>> }}
 */
function buildManifestGraph(suites) {
	const ids = [...new Set(suites.map(s => s.manifestId))]
	/** @type {Map<string, number>} */
	const depCount = new Map(ids.map(id => [id, 0]))
	/** @type {Map<string, number>} */
	const dependentCount = new Map(ids.map(id => [id, 0]))
	/** @type {Map<string, Set<string>>} */
	const deps = new Map(ids.map(id => [id, new Set()]))

	for (const suite of suites) 
		for (const dep of suite.dependencies ?? []) {
			if (dep.manifestId === suite.manifestId) continue
			const from = suite.manifestId
			const to = dep.manifestId
			if (deps.get(from).has(to)) continue
			deps.get(from).add(to)
			depCount.set(from, depCount.get(from) + 1)
			dependentCount.set(to, dependentCount.get(to) + 1)
		}
	
	return { depCount, dependentCount, deps }
}

/**
 * manifest id 排序：被依赖者在前；无依赖边时按被依赖数少→前、依赖数少→前、字典序。
 * @param {string[]} manifestIds 待排序 id
 * @param {SuiteDef[]} suites 全部 suite（用于解析跨 manifest 依赖）
 * @returns {string[]} 排序结果
 */
export function sortManifestIds(manifestIds, suites) {
	const unique = [...new Set(manifestIds)]
	if (unique.length <= 1) return unique

	const { depCount, dependentCount, deps } = buildManifestGraph(suites)

	/**
	 * @param {string} a manifest id
	 * @param {string} b manifest id
	 * @returns {number} 排序比较
	 */
	function compareTieBreak(a, b) {
		const depByA = dependentCount.get(a) ?? 0
		const depByB = dependentCount.get(b) ?? 0
		if (depByA !== depByB) return depByA - depByB
		const depA = depCount.get(a) ?? 0
		const depB = depCount.get(b) ?? 0
		if (depA !== depB) return depA - depB
		return a.localeCompare(b)
	}

	const idSet = new Set(unique)
	/** @type {Map<string, Set<string>>} */
	const subsetDeps = new Map(unique.map(id => [id, new Set()]))
	for (const id of unique) 
		for (const dep of deps.get(id) ?? []) {
			if (!idSet.has(dep)) continue
			subsetDeps.get(id).add(dep)
		}
	

	return topoSortKeys(unique, subsetDeps, compareTieBreak)
}

/**
 * 父项 trigger 过时或历史不完美时，沿 dependsOn 反向纳入下游。
 * @param {SuiteDef[]} selected 已选 suite
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {TestState} state 现状库
 * @param {object} ctx 上下文
 * @param {string} ctx.commitHash HEAD
 * @param {Map<string, string[]>} ctx.changedSinceRecordByKey 各 suite 自记录以来的变更
 * @returns {{ suites: SuiteDef[], provenance: Map<string, string> }} 扩展结果与纳入原因
 */
export function expandWithDependents(selected, allSuites, state, ctx) {
	/** @type {Map<string, string>} */
	const provenance = new Map()
	const needed = new Map(selected.map(s => [suiteKey(s.manifestId, s.name), s]))

	/** @type {Map<string, SuiteDef[]>} */
	const dependentsByKey = new Map()
	for (const suite of allSuites)
		for (const dep of suite.dependencies ?? []) {
			const depKey = suiteKey(dep.manifestId, dep.name)
			const list = dependentsByKey.get(depKey) ?? []
			list.push(suite)
			dependentsByKey.set(depKey, list)
		}

	/** @type {SuiteDef[]} */
	const expandFrom = []
	for (const suite of selected) {
		const key = suiteKey(suite.manifestId, suite.name)
		const entry = state.suites[key]
		const outdated = isSuiteOutdated(suite, entry, ctx.changedSinceRecordByKey.get(key) ?? [])
		if (outdated || entry?.status === 'failed' || entry?.status === 'noisy' || entry?.status === 'blocked')
			expandFrom.push(suite)
	}

	const queue = [...expandFrom]
	while (queue.length) {
		const suite = queue.shift()
		const key = suiteKey(suite.manifestId, suite.name)
		for (const dependent of dependentsByKey.get(key) ?? []) {
			const depKey = suiteKey(dependent.manifestId, dependent.name)
			if (needed.has(depKey)) continue
			needed.set(depKey, dependent)
			provenance.set(depKey, key)
			queue.push(dependent)
		}
	}

	return { suites: [...needed.values()], provenance }
}

/**
 * @param {SuiteDef[]} selected 已选 suite
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {TestState} state 现状库
 * @param {object} ctx 上下文
 * @param {string} ctx.commitHash HEAD
 * @param {string | null} ctx.uncommittedHash 未提交 digest
 * @param {Map<string, string[]>} ctx.changedSinceRecordByKey 各 suite 自记录以来的变更
 * @param {Set<string>} ctx.runGreenKeys 本次运行已通过键
 * @returns {{ suites: SuiteDef[], provenance: Map<string, string> }} 扩展并拓扑排序后的 suite 与纳入原因
 */
export function expandWithDependencies(selected, allSuites, state, ctx) {
	const byKey = new Map(allSuites.map(s => [suiteKey(s.manifestId, s.name), s]))
	const needed = new Map(selected.map(s => [suiteKey(s.manifestId, s.name), s]))
	/** @type {Map<string, string>} */
	const provenance = new Map()

	const queue = [...needed.values()]
	while (queue.length) {
		const suite = queue.shift()
		const parentKey = suiteKey(suite.manifestId, suite.name)
		for (const dep of suite.dependencies ?? []) {
			const depKey = suiteKey(dep.manifestId, dep.name)
			if (needed.has(depKey)) continue
			const depSuite = byKey.get(depKey)
			if (!depSuite)
				throw new Error(`missing dependency suite ${depKey} required by ${suite.manifestId}/${suite.name}`)
			const entry = state.suites[depKey]
			const outdated = isSuiteOutdated(depSuite, entry, ctx.changedSinceRecordByKey.get(depKey) ?? [])
			if (isDependencySatisfied(entry, outdated))
				continue
			needed.set(depKey, depSuite)
			provenance.set(depKey, parentKey)
			queue.push(depSuite)
		}
	}

	const suites = [...needed.values()]
	const cycle = detectDependencyCycle(suites)
	if (cycle)
		throw new Error(`dependency cycle detected: ${cycle}`)

	return { suites: topoSortSuites(suites, allSuites), provenance }
}

/**
 * 列出未满足的依赖键。
 * @param {SuiteDef} suite suite
 * @param {TestState} state 现状库
 * @param {object} ctx 上下文
 * @param {string} ctx.commitHash HEAD
 * @param {string | null} ctx.uncommittedHash 未提交 digest
 * @param {Map<string, string[]>} ctx.changedSinceRecordByKey 变更映射
 * @param {Set<string>} ctx.runGreenKeys 本次已通过
 * @param {Map<string, SuiteDef>} ctx.byKey 全部 suite 映射
 * @returns {string[]} 未满足依赖键
 */
export function listUnsatisfiedDependencies(suite, state, ctx) {
	/** @type {string[]} */
	const missing = []
	for (const dep of suite.dependencies ?? []) {
		const depKey = suiteKey(dep.manifestId, dep.name)
		if (ctx.runGreenKeys.has(depKey)) continue
		const depSuite = ctx.byKey.get(depKey)
		const entry = state.suites[depKey]
		const outdated = depSuite
			? isSuiteOutdated(depSuite, entry, ctx.changedSinceRecordByKey.get(depKey) ?? [])
			: true
		if (isDependencySatisfied(entry, outdated))
			continue
		missing.push(depKey)
	}
	return missing
}

/**
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {TestState} state 现状库
 * @param {string} commitHash HEAD
 * @param {string | null} uncommittedHash 未提交 digest
 * @param {Map<string, string[]>} changedSinceRecordByKey 变更映射
 * @returns {SuiteDef[]} 当前指纹下不完美的 suite
 */
export function listImperfectSuites(allSuites, state, commitHash, uncommittedHash, changedSinceRecordByKey) {
	return allSuites.filter(suite => {
		const key = suiteKey(suite.manifestId, suite.name)
		const entry = state.suites[key]
		const outdated = isSuiteOutdated(suite, entry, changedSinceRecordByKey.get(key) ?? [])
		if (isSuiteGreen(entry, commitHash, uncommittedHash, outdated)) return false
		return !entry || entry.status === 'failed' || entry.status === 'noisy' || entry.status === 'blocked' || outdated
	})
}

/**
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {TestState} state 现状库
 * @param {string} commitHash HEAD
 * @param {Map<string, string[]>} changedSinceRecordByKey 变更映射
 * @returns {SuiteDef[]} 仅 commit 漂移、trigger 仍新鲜的 passed suite
 */
export function listCommitStaleSuites(allSuites, state, commitHash, changedSinceRecordByKey) {
	return allSuites.filter(suite => {
		const key = suiteKey(suite.manifestId, suite.name)
		const entry = state.suites[key]
		if (!entry?.commitHash || entry.commitHash === commitHash) return false
		if (entry.status !== 'passed') return false
		const outdated = isSuiteOutdated(suite, entry, changedSinceRecordByKey.get(key) ?? [])
		return !outdated
	})
}

/**
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {TestState} state 现状库
 * @param {Map<string, string[]>} changedSinceRecordByKey 变更映射
 * @returns {SuiteDef[]} 陈旧或未跑过的 suite
 */
export function listOutdatedSuites(allSuites, state, changedSinceRecordByKey) {
	return allSuites.filter(suite => {
		const key = suiteKey(suite.manifestId, suite.name)
		const entry = state.suites[key]
		return isSuiteOutdated(suite, entry, changedSinceRecordByKey.get(key) ?? [])
	})
}
