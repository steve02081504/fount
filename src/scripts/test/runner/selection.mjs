import { console } from '../../i18n/bare.mjs'
import { collectChangesSinceRecord } from '../core/changed.mjs'
import { expandDiffDependents } from '../core/dependencies.mjs'
import { selectSuitesByDiff } from '../core/manifest.mjs'
import { collectTriggerEvidence, suiteKey } from '../core/state.mjs'

/**
 * @typedef {import('../core/manifest.mjs').SuiteDef} SuiteDef
 * @typedef {import('../core/state.mjs').TestState} TestState
 * @typedef {import('../core/verdict.mjs').Verdict} Verdict
 * @typedef {import('./continue_reason.mjs').GoalEvidence} GoalEvidence
 */

/**
 * @typedef {object} GoalSelection
 * @property {'run' | 'exit'} action
 * @property {number} [code]
 * @property {Set<string>} [goalKeys]
 * @property {Map<string, GoalEvidence>} [goalEvidenceByKey]
 * @property {Map<string, Map<string, string[] | undefined>>} [retryByManifest]
 * @property {'normal' | 'continue' | 'outdated'} [mode]
 */

/**
 * @param {SuiteDef[]} suites 候选 suite
 * @returns {SuiteDef[]} 去重后的 suite
 */
function dedupeSuites(suites) {
	const map = new Map()
	for (const suite of suites)
		map.set(suiteKey(suite.manifestId, suite.name), suite)
	return [...map.values()]
}

/**
 * @param {TestState} state 现状库
 * @param {string[] | undefined} manifestIds manifest 范围
 * @returns {Map<string, Map<string, string[] | undefined>>} manifest -> suite -> 失败文件
 */
export function buildRetryByManifest(state, manifestIds) {
	/** @type {Map<string, Map<string, string[] | undefined>>} */
	const retryByManifest = new Map()
	for (const [key, entry] of Object.entries(state.suites)) {
		if (!['failed', 'noisy'].includes(entry.status)) continue
		const slash = key.indexOf('/')
		const manifestId = key.slice(0, slash)
		if (manifestIds?.length && !manifestIds.includes(manifestId)) continue
		const name = key.slice(slash + 1)
		const map = retryByManifest.get(manifestId) ?? new Map()
		map.set(name, entry.failedFiles?.length ? entry.failedFiles : undefined)
		retryByManifest.set(manifestId, map)
	}
	return retryByManifest
}

/**
 * @param {SuiteDef[]} candidates 候选
 * @param {Map<string, Map<string, string[] | undefined>>} retryByManifest 重跑映射
 * @returns {Set<string>} 待重跑 suite 键
 */
function goalKeysFromFailureRetry(candidates, retryByManifest) {
	const retryManifestIds = [...retryByManifest.keys()]
	const allowedSuites = new Set([...retryByManifest.values()].flatMap(map => [...map.keys()]))
	return new Set(candidates
		.filter(suite => retryManifestIds.includes(suite.manifestId) && allowedSuites.has(suite.name))
		.map(suite => suiteKey(suite.manifestId, suite.name)))
}

/**
 * @param {string} repoRoot 仓库根
 * @param {SuiteDef[]} allSuites 全部 suite
 * @param {TestState} state 现状库
 * @returns {Promise<Map<string, string[]>>} suite 键 -> 自记录 commit 以来变更文件
 */
export async function buildCommittedChangedByKey(repoRoot, allSuites, state) {
	/** @type {Map<string, string[]>} */
	const map = new Map()
	await Promise.all(allSuites.map(async suite => {
		const key = suiteKey(suite.manifestId, suite.name)
		const entry = state.suites[key]
		map.set(key, await collectChangesSinceRecord(repoRoot, entry?.commitHash ?? null, []))
	}))
	return map
}

/**
 * @param {Map<string, Verdict>} verdicts 裁决表
 * @returns {Set<string>} --continue 目标键
 */
export function goalContinue(verdicts) {
	return new Set([...verdicts.entries()]
		.filter(([, verdict]) => verdict.kind !== 'green')
		.map(([key]) => key))
}

/**
 * @param {Map<string, Verdict>} verdicts 裁决表
 * @param {SuiteDef[]} scope 过滤范围
 * @returns {Set<string>} --outdated 目标键
 */
export function goalOutdated(verdicts, scope) {
	const scopeKeys = new Set(scope.map(s => suiteKey(s.manifestId, s.name)))
	return new Set([...verdicts.entries()]
		.filter(([key, verdict]) => scopeKeys.has(key) && verdict.kind === 'unknown')
		.map(([key]) => key))
}

/**
 * @param {string[]} changedFiles 变更文件
 * @param {SuiteDef[]} scope 过滤范围
 * @param {SuiteDef[]} allSuites 全部 suite（一层下游扩展）
 * @param {string} commitHash HEAD
 * @param {string | null} uncommittedHash 未提交 digest
 * @returns {{ goalKeys: Set<string>, goalEvidenceByKey: Map<string, GoalEvidence> }} 目标键与触发证据
 */
export function goalDiff(changedFiles, scope, allSuites, commitHash, uncommittedHash) {
	const hit = selectSuitesByDiff('diff', changedFiles, scope)
	const hitKeys = new Set(hit.map(s => suiteKey(s.manifestId, s.name)))
	const goalKeys = expandDiffDependents(hitKeys, allSuites)
	/** @type {Map<string, GoalEvidence>} */
	const goalEvidenceByKey = new Map()
	for (const suite of allSuites) {
		const key = suiteKey(suite.manifestId, suite.name)
		if (!goalKeys.has(key)) continue
		if (hitKeys.has(key)) {
			const evidence = collectTriggerEvidence(suite, changedFiles)
			if (evidence.matchedPaths.length)
				goalEvidenceByKey.set(key, {
					kind: 'diff_trigger_hit',
					toCommit: commitHash,
					toUncommittedHash: uncommittedHash,
					...evidence,
				})
		}
		else
			goalEvidenceByKey.set(key, { kind: 'diff_dependent', parentKey: [...hitKeys].find(hk =>
				suite.dependencies?.some(dep => suiteKey(dep.manifestId, dep.name) === hk)) ?? null })
	}
	return { goalKeys, goalEvidenceByKey }
}

/**
 * @param {SuiteDef[]} suites 显式选中 suite
 * @returns {{ goalKeys: Set<string>, goalEvidenceByKey: Map<string, GoalEvidence> }} 目标键与显式证据
 */
export function goalExplicit(suites) {
	const goalKeys = new Set(suites.map(s => suiteKey(s.manifestId, s.name)))
	const goalEvidenceByKey = new Map([...goalKeys].map(key => [key, { kind: 'explicit_selected' }]))
	return { goalKeys, goalEvidenceByKey }
}

/**
 * @param {object} params 参数
 * @param {Map<string, Verdict>} params.verdicts 裁决表
 * @param {TestState} params.state 现状库
 * @param {string} params.commitHash HEAD
 * @param {string | null} params.uncommittedHash 未提交 digest
 * @param {Map<string, string[]>} params.committedChangedByKey commit 变更
 * @returns {GoalSelection} 选择结果
 */
export function selectContinue({ verdicts, state, commitHash, uncommittedHash, committedChangedByKey }) {
	const goalKeys = goalContinue(verdicts)
	if (!goalKeys.size)
		return { action: 'exit', code: 0 }

	/** @type {Map<string, GoalEvidence>} */
	const goalEvidenceByKey = new Map()
	for (const key of goalKeys) {
		const entry = state.suites[key]
		if (!entry) {
			goalEvidenceByKey.set(key, {
				kind: 'missing_state_record',
				toCommit: commitHash,
				toUncommittedHash: uncommittedHash,
			})
			continue
		}
		const drift = {
			fromCommit: entry.commitHash,
			toCommit: commitHash,
			fromUncommittedHash: entry.uncommittedHash ?? null,
			toUncommittedHash: uncommittedHash,
		}
		if (entry.status === 'failed')
			goalEvidenceByKey.set(key, { kind: 'imperfect_failed', ...drift })
		else if (entry.status === 'noisy')
			goalEvidenceByKey.set(key, { kind: 'imperfect_noisy', ...drift })
		else if (entry.status === 'blocked')
			goalEvidenceByKey.set(key, { kind: 'imperfect_blocked', blockedBy: entry.blockedBy, ...drift })
		else if (verdicts.get(key)?.kind === 'unknown')
			goalEvidenceByKey.set(key, { kind: 'stale_content', ...drift })
	}

	return {
		action: 'run',
		mode: 'continue',
		goalKeys,
		goalEvidenceByKey,
		retryByManifest: buildRetryByManifest(state),
	}
}

/**
 * @param {object} params 参数
 * @param {Map<string, Verdict>} params.verdicts 裁决表
 * @param {SuiteDef[]} [params.filtered] 过滤范围
 * @returns {GoalSelection} 选择结果
 */
export function selectOutdated({ verdicts, filtered }) {
	const scope = filtered ?? []
	const goalKeys = goalOutdated(verdicts, scope)
	const evidenceByKey = new Map([...goalKeys].map(key => [key, { kind: 'stale_content' }]))
	return {
		action: 'run',
		mode: 'outdated',
		goalKeys,
		goalEvidenceByKey: evidenceByKey,
		retryByManifest: new Map(),
	}
}

/**
 * @param {object} params 选择参数
 * @param {SuiteDef[]} params.allSuites 全部 suite
 * @param {SuiteDef[]} params.filtered manifest/suite 过滤后
 * @param {{ mode: string, files: string[] }} params.changed 变更文件解析结果
 * @param {boolean} params.runAll 是否全量
 * @param {string[]} [params.manifestIds] manifest id 列表
 * @param {boolean} [params.explicitSuites] 是否显式指名 suite
 * @param {string} params.commitHash 当前 HEAD
 * @param {string | null} params.uncommittedHash 当前未提交 digest
 * @param {string[]} params.uncommittedFiles 未提交路径列表
 * @param {TestState} params.state 现状库
 * @returns {GoalSelection} 选择结果
 */
export function selectSuites({
	allSuites,
	filtered,
	changed,
	runAll,
	manifestIds,
	explicitSuites,
	commitHash,
	uncommittedHash,
	uncommittedFiles,
	state,
}) {
	if (runAll || explicitSuites)
		return {
			action: 'run',
			mode: 'normal',
			...goalExplicit(filtered),
			retryByManifest: buildRetryByManifest(state, manifestIds),
		}

	const retryByManifest = buildRetryByManifest(state, manifestIds)
	/** @type {Set<string>} */
	let goalKeys = new Set()
	/** @type {Map<string, GoalEvidence>} */
	let goalEvidenceByKey = new Map()

	if (retryByManifest.size) {
		goalKeys = goalKeysFromFailureRetry(filtered, retryByManifest)
		for (const key of goalKeys)
			goalEvidenceByKey.set(key, { kind: 'failure_retry' })
		console.logI18n('fountConsole.test.failureRetry', {
			manifests: [...retryByManifest.keys()].join(', '),
			count: goalKeys.size,
		})

		const hashStale = uncommittedFiles.length > 0 && [...retryByManifest.keys()].some(manifestId =>
			Object.entries(state.suites).some(([key, entry]) =>
				key.startsWith(`${manifestId}/`) && entry.uncommittedHash !== uncommittedHash))
		if (hashStale && changed.mode === 'diff' && changed.files.length) {
			const diff = goalDiff(changed.files, filtered, allSuites, commitHash, uncommittedHash)
			const before = goalKeys.size
			for (const key of diff.goalKeys) goalKeys.add(key)
			for (const [key, evidence] of diff.goalEvidenceByKey)
				if (!goalEvidenceByKey.has(key))
					goalEvidenceByKey.set(key, evidence)
			console.logI18n('fountConsole.test.hashStaleAppendDiff', {
				count: goalKeys.size - before,
			})
		}
	}
	else if (changed.mode === 'diff' && changed.files.length) {
		const diff = goalDiff(changed.files, filtered, allSuites, commitHash, uncommittedHash)
		goalKeys = diff.goalKeys
		goalEvidenceByKey = diff.goalEvidenceByKey
		console.logI18n('fountConsole.test.diffMode', {
			fileCount: changed.files.length,
			files: changed.files.slice(0, 12).join(', ')
				+ (changed.files.length > 12 ? '...' : ''),
		})
	}
	else if (changed.mode === 'none' && !manifestIds?.length) {
		console.logI18n('fountConsole.test.noChangesHint')
		console.logI18n('fountConsole.test.tip')
		return { action: 'exit', code: 0 }
	}
	else if (changed.mode === 'none' && manifestIds?.length) {
		console.logI18n('fountConsole.test.manifestNoDiffRunAll', {
			manifestIds: manifestIds.join(','),
		})
		const explicit = goalExplicit(filtered)
		goalKeys = explicit.goalKeys
		goalEvidenceByKey = explicit.goalEvidenceByKey
	}

	return {
		action: 'run',
		mode: 'normal',
		goalKeys,
		goalEvidenceByKey,
		retryByManifest,
	}
}
