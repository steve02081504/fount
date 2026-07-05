/**
 * 测试 suite 依赖解析、拓扑排序与扩展。
 */
import { filterSuites, suiteMatchesSelector } from './manifest.mjs'
import { isSuiteGreen, isSuiteOutdated, suiteKey } from './state.mjs'

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
 * 对 suite 列表拓扑排序（依赖在前）。
 * @param {SuiteDef[]} suites 待排序 suite
 * @returns {SuiteDef[]} 排序结果
 */
export function topoSortSuites(suites) {
	const byKey = new Map(suites.map(s => [suiteKey(s.manifestId, s.name), s]))
	/** @type {SuiteDef[]} */
	const sorted = []
	/** @type {Set<string>} */
	const visited = new Set()

	/**
	 * @param {string} key suite 键
	 */
	function visit(key) {
		if (visited.has(key)) return
		visited.add(key)
		const suite = byKey.get(key)
		if (!suite) return
		for (const dep of suite.dependencies ?? [])
			visit(suiteKey(dep.manifestId, dep.name))
		sorted.push(suite)
	}

	for (const key of byKey.keys())
		visit(key)

	return sorted
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
 * @returns {SuiteDef[]} 扩展并拓扑排序后的 suite
 */
export function expandWithDependencies(selected, allSuites, state, ctx) {
	const byKey = new Map(allSuites.map(s => [suiteKey(s.manifestId, s.name), s]))
	const needed = new Map(selected.map(s => [suiteKey(s.manifestId, s.name), s]))

	/**
	 * @param {SuiteDef} suite suite
	 * @returns {boolean} 依赖是否全部满足
	 */
	function dependencySatisfied(suite) {
		for (const dep of suite.dependencies ?? []) {
			const depKey = suiteKey(dep.manifestId, dep.name)
			if (ctx.runGreenKeys.has(depKey)) continue
			const depSuite = byKey.get(depKey)
			const entry = state.suites[depKey]
			const outdated = depSuite
				? isSuiteOutdated(depSuite, entry, ctx.changedSinceRecordByKey.get(depKey) ?? [])
				: true
			if (isSuiteGreen(entry, ctx.commitHash, ctx.uncommittedHash, outdated))
				continue
			return false
		}
		return true
	}

	const queue = [...needed.values()]
	while (queue.length) {
		const suite = queue.shift()
		for (const dep of suite.dependencies ?? []) {
			const depKey = suiteKey(dep.manifestId, dep.name)
			if (needed.has(depKey)) continue
			const depSuite = byKey.get(depKey)
			if (!depSuite)
				throw new Error(`missing dependency suite ${depKey} required by ${suite.manifestId}/${suite.name}`)
			needed.set(depKey, depSuite)
			queue.push(depSuite)
		}
	}

	const suites = [...needed.values()]
	const cycle = detectDependencyCycle(suites)
	if (cycle)
		throw new Error(`dependency cycle detected: ${cycle}`)

	return topoSortSuites(suites)
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
		if (isSuiteGreen(entry, ctx.commitHash, ctx.uncommittedHash, outdated))
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
 * @param {string | null} uncommittedHash 未提交 digest
 * @param {Map<string, string[]>} changedSinceRecordByKey 变更映射
 * @returns {SuiteDef[]} 陈旧或未跑过的 suite
 */
export function listOutdatedSuites(allSuites, state, commitHash, uncommittedHash, changedSinceRecordByKey) {
	return allSuites.filter(suite => {
		const key = suiteKey(suite.manifestId, suite.name)
		const entry = state.suites[key]
		return isSuiteOutdated(suite, entry, changedSinceRecordByKey.get(key) ?? [])
	})
}

/**
 * @param {string} selector suite selector
 * @param {SuiteDef} suite suite
 * @returns {boolean} 是否匹配
 */
export function selectorMatchesSuite(selector, suite) {
	return suiteMatchesSelector(suite, selector)
}
