import { collectTriggerEvidence, isSuiteOutdated, suiteKey } from '../core/state.mjs'

/**
 * @typedef {import('../core/manifest.mjs').SuiteDef} SuiteDef
 * @typedef {import('../core/state.mjs').SuiteStateEntry} SuiteStateEntry
 * @typedef {import('../core/state.mjs').TestState} TestState
 */

/**
 * @typedef {'pending_from_previous_report' | 'imperfect_failed' | 'imperfect_noisy' | 'imperfect_blocked' | 'missing_state_record' | 'outdated_trigger_hit' | 'diff_trigger_hit' | 'explicit_selected' | 'dependency_required'} ContinueReasonKind
 */

/**
 * @typedef {object} ContinueReason
 * @property {ContinueReasonKind} kind
 * @property {string | null} [fromCommit]
 * @property {string} [toCommit]
 * @property {string | null} [fromUncommittedHash]
 * @property {string | null} [toUncommittedHash]
 * @property {string[]} [matchedTriggers]
 * @property {string[]} [matchedPaths]
 * @property {string[]} [blockedBy]
 * @property {string} [requiredBy]
 * @property {'upstream' | 'downstream'} [pull]
 * @property {string} [rootKey]
 * @property {ContinueReasonKind} [rootKind]
 * @property {string[]} [inclusionPath]
 * @property {ContinueReason} [gate]
 */

/**
 * @returns {ContinueReason} 上次报告 pending 续跑
 */
export function pendingContinueReason() {
	return { kind: 'pending_from_previous_report' }
}

/**
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @param {string} commitHash 当前 HEAD
 * @param {string | null} uncommittedHash 当前未提交 digest
 * @param {string[]} changedFiles 自记录以来的变更
 * @returns {ContinueReason | null} 触发原因；suite 完美/门禁已满足则返回 null
 */
function buildSuiteTriggerReason(suite, entry, commitHash, uncommittedHash, changedFiles) {
	const outdated = isSuiteOutdated(suite, entry, changedFiles)

	if (!entry)
		return { kind: 'missing_state_record', toCommit: commitHash, toUncommittedHash: uncommittedHash }

	if (entry.status === 'failed')
		return {
			kind: 'imperfect_failed',
			fromCommit: entry.commitHash,
			toCommit: commitHash,
			fromUncommittedHash: entry.uncommittedHash ?? null,
			toUncommittedHash: uncommittedHash,
		}

	if (entry.status === 'noisy')
		return {
			kind: 'imperfect_noisy',
			fromCommit: entry.commitHash,
			toCommit: commitHash,
			fromUncommittedHash: entry.uncommittedHash ?? null,
			toUncommittedHash: uncommittedHash,
		}

	if (entry.status === 'blocked')
		return {
			kind: 'imperfect_blocked',
			blockedBy: entry.blockedBy,
			fromCommit: entry.commitHash,
			toCommit: commitHash,
			fromUncommittedHash: entry.uncommittedHash ?? null,
			toUncommittedHash: uncommittedHash,
		}

	if (outdated) {
		const evidence = collectTriggerEvidence(suite, changedFiles)
		return {
			kind: 'outdated_trigger_hit',
			fromCommit: entry.commitHash,
			toCommit: commitHash,
			fromUncommittedHash: entry.uncommittedHash ?? null,
			toUncommittedHash: uncommittedHash,
			...evidence,
		}
	}

	return null
}

/**
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @param {string} commitHash 当前 HEAD
 * @param {string | null} uncommittedHash 当前未提交 digest
 * @param {string[]} changedFiles 自记录以来的变更
 * @returns {ContinueReason} 不完美 suite 的续跑原因
 */
export function buildImperfectContinueReason(suite, entry, commitHash, uncommittedHash, changedFiles) {
	const reason = buildSuiteTriggerReason(suite, entry, commitHash, uncommittedHash, changedFiles)
	if (!reason)
		throw new Error(`buildImperfectContinueReason: ${suite.manifestId}/${suite.name} is not imperfect`)
	return reason
}

/**
 * @param {SuiteDef[]} suites suite 列表
 * @param {TestState} state 现状库
 * @param {string} commitHash HEAD
 * @param {string | null} uncommittedHash 未提交 digest
 * @param {Map<string, string[]>} changedSinceRecordByKey 变更映射
 * @returns {Map<string, ContinueReason>} suite 键 -> 续跑原因
 */
export function buildContinueReasonsForSuites(suites, state, commitHash, uncommittedHash, changedSinceRecordByKey) {
	/** @type {Map<string, ContinueReason>} */
	const map = new Map()
	for (const suite of suites) {
		const key = suiteKey(suite.manifestId, suite.name)
		const changedFiles = changedSinceRecordByKey.get(key) ?? []
		map.set(key, buildImperfectContinueReason(
			suite,
			state.suites[key],
			commitHash,
			uncommittedHash,
			changedFiles,
		))
	}
	return map
}

/**
 * @returns {ContinueReason} 显式指名
 */
export function explicitSelectedReason() {
	return { kind: 'explicit_selected' }
}

/**
 * @param {string} key 目标 suite 键
 * @param {Map<string, string>} provenance suite 键 -> 直接纳入方
 * @param {Set<string>} seedKeys 初选 suite 键
 * @returns {string} 追溯到的根 suite 键
 */
export function resolveRootKeyFromProvenance(key, provenance, seedKeys) {
	let current = key
	const seen = new Set()
	while (!seedKeys.has(current)) {
		if (seen.has(current)) break
		seen.add(current)
		const parent = provenance.get(current)
		if (!parent) break
		current = parent
	}
	return current
}

/**
 * @param {string} key 目标 suite 键
 * @param {Map<string, string>} provenance suite 键 -> 直接纳入方
 * @param {string} rootKey 根 suite 键
 * @returns {string[]} 从根到目标的纳入链（含两端）
 */
export function buildInclusionPath(key, provenance, rootKey) {
	if (key === rootKey) return [key]
	/** @type {string[]} */
	const tail = [key]
	const seen = new Set([key])
	let current = key
	while (provenance.has(current)) {
		const parent = provenance.get(current)
		if (!parent || seen.has(parent)) break
		tail.unshift(parent)
		seen.add(parent)
		current = parent
		if (current === rootKey) break
	}
	if (tail[0] !== rootKey)
		tail.unshift(rootKey)
	return tail
}

/**
 * @param {string} key 目标 suite 键
 * @param {string} requiredBy 直接纳入方
 * @param {Map<string, SuiteDef>} byKey 全部 suite
 * @returns {'upstream' | 'downstream'} 纳入方向
 */
export function inferPullDirection(key, requiredBy, byKey) {
	const suite = byKey.get(key)
	const consumer = byKey.get(requiredBy)
	if (consumer?.dependencies?.some(dep => suiteKey(dep.manifestId, dep.name) === key))
		return 'upstream'
	if (suite?.dependencies?.some(dep => suiteKey(dep.manifestId, dep.name) === requiredBy))
		return 'downstream'
	throw new Error(`inferPullDirection: no edge between ${key} and ${requiredBy}`)
}

/**
 * @param {SuiteDef} suite suite
 * @param {SuiteStateEntry | undefined} entry 现状条目
 * @param {string} commitHash HEAD
 * @param {string | null} uncommittedHash 未提交 digest
 * @param {string[]} changedFiles 自记录以来的变更
 * @returns {ContinueReason | null} 依赖门禁未满足的具体原因；已满足则 null
 */
export function buildDepGateReason(suite, entry, commitHash, uncommittedHash, changedFiles) {
	return buildSuiteTriggerReason(suite, entry, commitHash, uncommittedHash, changedFiles)
}

/**
 * @param {object} params 参数
 * @param {string} params.key 目标 suite 键
 * @param {string} params.requiredBy 直接纳入方
 * @param {SuiteDef[]} params.selected 最终选中 suite
 * @param {Map<string, string>} params.provenance 纳入 provenance
 * @param {Map<string, ContinueReason>} params.reasons 已写入原因
 * @param {Set<string>} params.seedKeys 初选 suite 键
 * @param {TestState} params.state 现状库
 * @param {object} params.context 指纹上下文
 * @param {string} params.context.commitHash HEAD
 * @param {string | null} params.context.uncommittedHash 未提交 digest
 * @param {Map<string, string[]>} params.context.changedSinceRecordByKey 变更映射
 * @param {Map<string, SuiteDef>} params.context.byKey 全部 suite
 * @returns {ContinueReason} 依赖扩展纳入（含根因、纳入链、门禁原因）
 */
export function buildDependencyContinueReason({
	key,
	requiredBy,
	selected,
	provenance,
	reasons,
	seedKeys,
	state,
	context,
}) {
	const byKey = context.byKey ?? new Map(selected.map(s => [suiteKey(s.manifestId, s.name), s]))
	const rootKey = resolveRootKeyFromProvenance(key, provenance, seedKeys)
	const rootReason = reasons.get(rootKey)
	const pull = inferPullDirection(key, requiredBy, byKey)
	const inclusionPath = buildInclusionPath(key, provenance, rootKey)
	const gateSuite = pull === 'upstream' ? byKey.get(key) : byKey.get(requiredBy)
	const gateKey = pull === 'upstream' ? key : requiredBy
	if (!gateSuite)
		throw new Error(`buildDependencyContinueReason: missing suite ${gateKey}`)

	const gate = buildDepGateReason(
		gateSuite,
		state.suites[gateKey],
		context.commitHash,
		context.uncommittedHash,
		context.changedSinceRecordByKey.get(gateKey) ?? [],
	)
	/** @type {ContinueReason} */
	const reason = {
		kind: 'dependency_required',
		requiredBy,
		pull,
		rootKey,
		rootKind: rootReason?.kind,
		inclusionPath,
		gate: gate ?? undefined,
	}
	return reason
}

/**
 * 在选中集合内推断 suite 的直接纳入方（扩展 provenance 的 fallback）。
 * @param {string} key 目标 suite 键
 * @param {SuiteDef[]} selected 最终选中 suite
 * @param {Set<string>} seedKeys 扩展前初选 suite 键
 * @returns {string | null} 直接纳入方 suite 键；追溯不到（该槽位相对当前种子是孤立根）返回 null
 */
export function findDirectRequiredBy(key, selected, seedKeys) {
	const byKey = new Map(selected.map(s => [suiteKey(s.manifestId, s.name), s]))
	const selectedKeys = new Set(byKey.keys())

	/**
	 * @param {string} k suite 键
	 * @param {Set<string>} visiting 访问集
	 * @returns {number} 沿 dependsOn 到最近 seed 的跳数；不可达为 Infinity
	 */
	function hopsToSeed(k, visiting) {
		if (seedKeys.has(k)) return 0
		if (visiting.has(k)) return Infinity
		visiting.add(k)
		let min = Infinity
		for (const dep of byKey.get(k)?.dependencies ?? []) {
			const depKey = suiteKey(dep.manifestId, dep.name)
			if (!selectedKeys.has(depKey)) continue
			min = Math.min(min, 1 + hopsToSeed(depKey, new Set(visiting)))
		}
		return min
	}

	const depKeys = (byKey.get(key)?.dependencies ?? [])
		.map(dep => suiteKey(dep.manifestId, dep.name))
		.filter(depKey => selectedKeys.has(depKey))

	// 1) 本项作为「被下游 seed 拉起的上游」：取路由到 seed 最近的依赖
	const finiteDeps = depKeys
		.map(depKey => ({ depKey, hops: hopsToSeed(depKey, new Set()) }))
		.filter(d => d.hops < Infinity)
		.sort((a, b) => a.hops - b.hops)
	if (finiteDeps.length) return finiteDeps[0].depKey

	// 2) 本项作为「被上游 outdated 拉起的下游」：取离 seed 最近的消费者
	const consumers = selected
		.filter(s => s.dependencies?.some(dep => suiteKey(dep.manifestId, dep.name) === key))
		.map(s => suiteKey(s.manifestId, s.name))
		.sort((a, b) => hopsToSeed(a, new Set()) - hopsToSeed(b, new Set()))
	if (consumers.length) return consumers[0]

	// 3) 兜底：任一依赖；相对当前种子孤立则 null
	return depKeys[0] ?? null
}

/**
 * 为扩展纳入的 suite 写入触发原因。
 * @param {Map<string, ContinueReason>} reasons 原因映射（就地修改）
 * @param {SuiteDef[]} selected 最终选中 suite
 * @param {Set<string>} seedKeys 扩展前初选 suite 键
 * @param {Map<string, string>} provenance suite 键 -> 直接纳入方
 * @param {object} options 选项
 * @param {boolean} [options.explicitSuites] 是否显式指名
 * @param {TestState} options.state 现状库
 * @param {object} options.context 指纹上下文
 * @param {string} options.context.commitHash HEAD
 * @param {string | null} options.context.uncommittedHash 未提交 digest
 * @param {Map<string, string[]>} options.context.changedSinceRecordByKey 变更映射
 * @param {Map<string, SuiteDef>} options.context.byKey 全部 suite
 */
export function stampExpansionReasons(reasons, selected, seedKeys, provenance, { explicitSuites = false, state, context }) {
	for (const key of seedKeys)
		if (explicitSuites && !reasons.has(key))
			reasons.set(key, explicitSelectedReason())

	for (const suite of selected) {
		const key = suiteKey(suite.manifestId, suite.name)
		if (seedKeys.has(key) || reasons.has(key)) continue
		const requiredBy = provenance.get(key) ?? findDirectRequiredBy(key, selected, seedKeys)
		if (!requiredBy) continue
		reasons.set(key, buildDependencyContinueReason({
			key,
			requiredBy,
			selected,
			provenance,
			reasons,
			seedKeys,
			state,
			context,
		}))
	}
}

/**
 * @param {SuiteDef[]} suites diff 初选 suite
 * @param {string[]} changedFiles 变更文件
 * @param {string} commitHash HEAD
 * @param {string | null} uncommittedHash 未提交 digest
 * @returns {Map<string, ContinueReason>} suite 键 -> diff 触发原因
 */
export function buildDiffSelectionReasons(suites, changedFiles, commitHash, uncommittedHash) {
	/** @type {Map<string, ContinueReason>} */
	const map = new Map()
	for (const suite of suites) {
		const evidence = collectTriggerEvidence(suite, changedFiles)
		if (!evidence.matchedPaths.length) continue
		map.set(suiteKey(suite.manifestId, suite.name), {
			kind: 'diff_trigger_hit',
			toCommit: commitHash,
			toUncommittedHash: uncommittedHash,
			...evidence,
		})
	}
	return map
}
