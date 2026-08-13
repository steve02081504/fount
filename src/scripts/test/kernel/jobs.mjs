/**
 * 把 CLI job 展开成 plan 槽位（复用现有 selection / plan）。
 */
import { digestFileHashes, getHeadCommitHash, getUncommittedFiles, hashUncommittedFiles } from '../core/changed.mjs'
import { topoSortSuites } from '../core/dependencies.mjs'
import {
	filterSuites,
	listManifestIds,
	loadAllSuites,
	resolveManifestSelectors,
} from '../core/manifest.mjs'
import { buildPlan } from '../core/plan.mjs'
import { validateSubtestFilters } from '../core/serial_files.mjs'
import { skipBecauseSuiteKeys } from '../core/skip_because.mjs'
import { pruneAbsentState, readState, suiteKey, writeState } from '../core/state.mjs'
import { auditTriggerCoverage } from '../core/trigger_audit.mjs'
import { buildVerdicts } from '../core/verdict.mjs'
import { buildReasonsFromPlan, serializeContinueReasons } from '../runner/continue_reason.mjs'
import {
	buildCommittedChangedByKey,
	collectSubtestFilterByKey,
	listFreshNoisyKeys,
	selectDefaultWave,
	selectExplicitOrAll,
} from '../runner/selection.mjs'

import { attachGitRoots, snapshotNestedGit, writeNestedGitState } from './nested_git.mjs'


/**
 * @typedef {import('../runner/index.mjs').GroupInput} GroupInput
 */

/**
 * 解析 CLI 分组。
 * @param {GroupInput[]} groupInputs 分组
 * @param {string[]} knownIds manifest id
 * @param {import('../core/manifest.mjs').SuiteDef[]} allSuites suite
 * @returns {{ groups: import('../runner/selection.mjs').ResolvedGroup[], unmatched: string[] }} 结果
 */
export function resolveGroups(groupInputs, knownIds, allSuites) {
	/** @type {import('../runner/selection.mjs').ResolvedGroup[]} */
	const groups = []
	/** @type {string[]} */
	const unmatched = []
	for (const input of groupInputs) {
		const resolved = resolveManifestSelectors(input.manifestSelectors, knownIds, allSuites)
		if (resolved.unmatched.length) {
			unmatched.push(...resolved.unmatched)
			continue
		}
		groups.push({
			manifestIds: resolved.manifestIds,
			suiteSelectors: input.suiteSelectors,
			subtestSelectors: input.subtestSelectors ?? {},
		})
	}
	return { groups, unmatched }
}

/**
 * @param {import('../core/manifest.mjs').SuiteDef[]} allSuites suite
 * @param {import('../runner/selection.mjs').ResolvedGroup[]} groups 分组
 * @returns {import('../core/manifest.mjs').SuiteDef[]} 去重 suite
 */
export function filterFromGroups(allSuites, groups) {
	const seen = new Map()
	for (const group of groups)
		for (const suite of filterSuites(allSuites, {
			manifestIds: group.manifestIds,
			suiteSelectors: group.suiteSelectors.length ? group.suiteSelectors : undefined,
		}))
			seen.set(`${suite.manifestId}\0${suite.name}`, suite)
	return [...seen.values()]
}

/**
 * @param {import('../core/manifest.mjs').SuiteDef[]} allSuites suite
 * @param {import('../runner/selection.mjs').ResolvedGroup[]} groups 分组
 * @returns {string[]} 未命中选择器
 */
export function unmatchedSuiteSelectors(allSuites, groups) {
	/** @type {string[]} */
	const missing = []
	for (const group of groups) {
		if (!group.suiteSelectors.length) continue
		const manifestLabel = group.manifestIds.join('|')
		for (const sel of group.suiteSelectors) {
			const hits = filterSuites(allSuites, {
				manifestIds: group.manifestIds,
				suiteSelectors: [sel],
			})
			if (!hits.length)
				missing.push(`${manifestLabel}:${sel}`)
		}
	}
	return missing
}

/**
 * 加载 suite、挂 gitRoot、读 state。
 * @param {string} repoRoot 仓库根
 * @returns {Promise<object>} 上下文
 */
export async function loadKernelCatalog(repoRoot) {
	const allSuites = await loadAllSuites(repoRoot)
	await attachGitRoots(allSuites, repoRoot)
	const state = await readState(repoRoot)
	const pruned = await pruneAbsentState(repoRoot, allSuites, state)
	if (pruned.changed)
		await writeState(repoRoot, state)
	return { allSuites, state, pruned, byKey: new Map(allSuites.map(s => [suiteKey(s.manifestId, s.name), s])) }
}

/**
 * 展开一波 CLI job。
 * @param {object} params 参数
 * @returns {Promise<object>} 波次或错误
 */
export async function expandJobWave(params) {
	const { repoRoot, options, catalog } = params
	const probedSkip = options.probedSkip ?? new Set()
	const { allSuites, state, byKey } = catalog
	const deadTriggers = await auditTriggerCoverage(repoRoot, allSuites)
	if (deadTriggers.length)
		return { error: 'deadTriggers', deadTriggers, code: 1 }

	const knownIds = listManifestIds(allSuites)
	let filtered = allSuites
	let explicitSuites = false
	/** @type {Map<string, string[]>} */
	let subtestFilterByKey = new Map()
	/** @type {string[] | undefined} */
	let manifestIds

	if (options.groups?.length) {
		const { groups: resolved, unmatched } = resolveGroups(options.groups, knownIds, allSuites)
		if (unmatched.length)
			return { error: 'unknownManifest', unmatched, knownIds, code: 2, empty: true }
		manifestIds = [...new Set(resolved.flatMap(group => group.manifestIds))]
		explicitSuites = true
		const unknownSuites = unmatchedSuiteSelectors(allSuites, resolved)
		if (unknownSuites.length)
			return { error: 'unknownSuite', unknownSuites, available: availableSuiteIds(allSuites, manifestIds), code: 2, empty: true }
		filtered = filterFromGroups(allSuites, resolved)
		subtestFilterByKey = collectSubtestFilterByKey(resolved, filtered)
		const filterErrors = validateSubtestFilters(subtestFilterByKey, byKey, repoRoot)
		if (filterErrors.length)
			return { error: 'subtestFilter', filterErrors, code: 2, empty: true }
	}

	if (probedSkip.size)
		filtered = filtered.filter(suite => !probedSkip.has(suiteKey(suite.manifestId, suite.name)))

	const [commitHash, uncommittedFiles] = await Promise.all([
		getHeadCommitHash(repoRoot),
		getUncommittedFiles(repoRoot),
	])
	const uncommittedHashes = await hashUncommittedFiles(repoRoot, uncommittedFiles)
	const uncommittedHash = digestFileHashes(uncommittedHashes, uncommittedFiles)

	/** @type {Map<string, import('./nested_git.mjs').NestedGitSnapshot>} */
	const nested = new Map()
	const gitRoots = [...new Set(allSuites.map(suite => suite.gitRoot).filter(Boolean))]
	for (const gitRoot of gitRoots)
		nested.set(gitRoot, await snapshotNestedGit(repoRoot, gitRoot))
	if (nested.size) {
		await writeNestedGitState(repoRoot, Object.fromEntries(
			[...nested].map(([root, snap]) => [root, { commitHash: snap.commitHash, uncommittedHash: snap.uncommittedHash }]),
		))
		for (const snap of nested.values())
			for (const [path, digest] of snap.uncommittedHashes)
				uncommittedHashes.set(path, digest)
	}

	const committedChangedByKey = await buildCommittedChangedByKey(repoRoot, allSuites, state)
	const issueStates = options.issueStates
	const verdicts = buildVerdicts(allSuites, state, committedChangedByKey, uncommittedHashes, issueStates)

	const fingerprints = { commitHash, uncommittedHash, uncommittedFiles, uncommittedHashes, committedChangedByKey, nested }

	if (options.runAll || explicitSuites) {
		const selection = selectExplicitOrAll({
			filtered,
			state,
			manifestIds,
			runAll: options.runAll === true,
			subtestFilterByKey,
		})
		if (selection.action === 'exit')
			return {
				error: explicitSuites ? 'noMatchingSuites' : null,
				available: explicitSuites ? availableSuiteIds(allSuites, manifestIds) : [],
				code: explicitSuites ? 2 : 0,
				empty: true,
			}
		return finishWave(selection, verdicts, byKey, allSuites, options.force, subtestFilterByKey, fingerprints, filtered)
	}

	const selection = selectDefaultWave({
		verdicts,
		state,
		allSuites,
		scope: filtered,
		committedChangedByKey,
		uncommittedFiles,
		commitHash,
		uncommittedHash,
		issueStates,
	})
	if (selection.action === 'run')
		return finishWave(selection, verdicts, byKey, allSuites, options.force, subtestFilterByKey, fingerprints, filtered)

	const noisyKeys = listFreshNoisyKeys(verdicts, filtered)
	if (noisyKeys.length)
		return { error: 'noisyOnly', noisyKeys, code: 1, empty: true, filtered, verdicts, fingerprints }

	const skipKeys = skipBecauseSuiteKeys(filtered).filter(key => !probedSkip.has(key))
	if (skipKeys.length) {
		const plan = {
			slots: skipKeys.map(key => ({
				key,
				suite: byKey.get(key),
				action: 'run',
				goal: true,
				goalEvidence: { kind: 'skip_because' },
			})),
			goalKeys: new Set(skipKeys),
		}
		return {
			selection: { action: 'run', mode: 'skip_because', goalKeys: new Set(skipKeys) },
			plan,
			verdicts,
			fingerprints,
			continueReasons: buildReasonsFromPlan(plan),
			filtered,
		}
	}

	return { empty: true, code: 0, filtered, verdicts, fingerprints }
}

/**
 * @param {import('../runner/selection.mjs').GoalSelection} selection 选择
 * @param {Map<string, import('../core/verdict.mjs').Verdict>} verdicts 裁决
 * @param {Map<string, import('../core/manifest.mjs').SuiteDef>} byKey suite 表
 * @param {import('../core/manifest.mjs').SuiteDef[]} allSuites 全部 suite
 * @param {boolean | undefined} force 强制
 * @param {Map<string, string[]>} subtestFilterByKey 子测试过滤
 * @param {object} fingerprints 指纹
 * @param {import('../core/manifest.mjs').SuiteDef[]} filtered 范围
 * @returns {object} 波次
 */
function finishWave(selection, verdicts, byKey, allSuites, force, subtestFilterByKey, fingerprints, filtered) {
	const plan = buildPlan(
		selection.goalKeys,
		verdicts,
		byKey,
		allSuites,
		selection.goalEvidenceByKey ?? new Map(),
		force,
		subtestFilterByKey,
	)
	return {
		selection,
		plan,
		verdicts,
		fingerprints,
		continueReasons: buildReasonsFromPlan(plan),
		filtered,
	}
}

/**
 * 把波次结果收成 display 用的 accepted 字段（不含 WS 的 mode / viewerId）。
 * @param {object} wave expandJobWave 结果
 * @param {object} [counts] 槽位计数
 * @param {number} [counts.runCount=0] 真跑
 * @param {number} [counts.reuseCount=0] 复用
 * @param {number} [counts.blockedCount=0] 阻塞
 * @param {number} [counts.skippedCount=0] skip_tree 跳过
 * @returns {object} accepted 字段
 */
export function acceptedFromWave(wave, counts = {}) {
	const mode = wave.selection?.mode
	const goalCount = wave.selection?.goalKeys?.size ?? 0
	const imperfectCount = counts.imperfectCount
		?? wave.selection?.imperfectKeys?.size
		?? (mode === 'imperfect' ? goalCount : 0)
	const outdatedCount = counts.outdatedCount
		?? (mode === 'outdated' ? goalCount
			: mode === 'continue' ? Math.max(0, goalCount - imperfectCount)
			: 0)
	return {
		runCount: counts.runCount ?? 0,
		reuseCount: counts.reuseCount ?? 0,
		blockedCount: counts.blockedCount ?? 0,
		skippedCount: counts.skippedCount ?? 0,
		code: wave.code ?? 0,
		empty: wave.empty === true,
		error: wave.error ?? null,
		selectionMode: wave.selection?.mode ?? null,
		goalCount,
		imperfectCount,
		outdatedCount,
		total: wave.filtered?.length ?? 0,
		noisyKeys: wave.noisyKeys ?? [],
		deadTriggers: wave.deadTriggers ?? [],
		unmatched: wave.unmatched ?? [],
		unknownSuites: wave.unknownSuites ?? [],
		filterErrors: wave.filterErrors ?? [],
		knownIds: wave.knownIds ?? [],
		available: wave.available ?? [],
		continueReasons: counts.continueReasons ?? serializeContinueReasons(wave.continueReasons),
		remainingMs: counts.remainingMs ?? wave.remainingMs ?? null,
		unknownCount: counts.unknownCount ?? wave.unknownCount ?? 0,
	}
}

/**
 * 本波命中路径：committed ∪ uncommitted。
 * @param {object} fingerprints 指纹
 * @param {string} key suite 键
 * @returns {string[]} 路径
 */
export function changedFilesForRun(fingerprints, key) {
	return [...new Set([
		...fingerprints?.committedChangedByKey?.get(key) ?? [],
		...fingerprints?.uncommittedFiles ?? [],
	])]
}

/**
 * 从裁决抽出 suite / 子测试 trigger 指纹。
 * @param {import('../core/verdict.mjs').Verdict | undefined} verdict 裁决
 * @returns {{ triggerHash: string | null, subtestTriggerHashes: Record<string, string | null> }} 指纹
 */
export function triggerHashesFromVerdict(verdict) {
	return {
		triggerHash: verdict?.triggerHash ?? null,
		subtestTriggerHashes: verdict?.subtests
			? Object.fromEntries(Object.entries(verdict.subtests).map(([name, sub]) => [name, sub.triggerHash ?? null]))
			: {},
	}
}

/**
 * 按 job spec 拼等效 CLI 串（报告用）。
 * @param {object} [spec] job
 * @returns {string} 如 `fount test --force shells/chat`
 */
export function jobCommand(spec = {}) {
	const parts = ['fount test']
	if (spec.runAll) parts.push('--all')
	if (spec.force) parts.push('--force')
	if (spec.groups?.length)
		for (const group of spec.groups) {
			const manifest = group.manifestSelectors?.[0]
			if (group.suiteSelectors?.length)
				parts.push(`${manifest}:${group.suiteSelectors.map(suite => {
					const subs = group.subtestSelectors?.[suite]
					return subs?.length ? `${suite}:${subs.join(',')}` : suite
				}).join(',')}`)
			else if (manifest)
				parts.push(manifest)
		}
	return parts.join(' ')
}

/**
 * @param {import('../core/manifest.mjs').SuiteDef[]} allSuites suite
 * @param {string[] | undefined} manifestIds 范围
 * @returns {string[]} 可用 id
 */
export function availableSuiteIds(allSuites, manifestIds) {
	const scope = manifestIds?.length
		? allSuites.filter(s => manifestIds.includes(s.manifestId))
		: allSuites
	return topoSortSuites(scope, allSuites).map(s => s.id)
}
