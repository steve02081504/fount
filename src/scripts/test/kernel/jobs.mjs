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
import {
	buildCommittedChangedByKey,
	collectSubtestFilterByKey,
	listFreshNoisyKeys,
	selectExplicitOrAll,
	selectImperfectWave,
	selectOutdatedWave,
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
			return { error: 'unknownManifest', unmatched, knownIds, code: 2 }
		manifestIds = [...new Set(resolved.flatMap(group => group.manifestIds))]
		explicitSuites = resolved.some(group => group.suiteSelectors.length)
		const unknownSuites = unmatchedSuiteSelectors(allSuites, resolved)
		if (unknownSuites.length)
			return { error: 'unknownSuite', unknownSuites, manifestIds, code: 2 }
		filtered = filterFromGroups(allSuites, resolved)
		subtestFilterByKey = collectSubtestFilterByKey(resolved, filtered)
		const filterErrors = validateSubtestFilters(subtestFilterByKey, byKey, repoRoot)
		if (filterErrors.length)
			return { error: 'subtestFilter', filterErrors, code: 2 }
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
	const verdicts = buildVerdicts(allSuites, state, committedChangedByKey, uncommittedHashes)

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
			return { error: explicitSuites ? 'noMatchingSuites' : null, code: explicitSuites ? 2 : 0, empty: true }
		const plan = buildPlan(
			selection.goalKeys,
			verdicts,
			byKey,
			allSuites,
			selection.goalEvidenceByKey ?? new Map(),
			options.force,
			subtestFilterByKey,
		)
		return { selection, plan, verdicts, fingerprints, continueLoop: false, filtered }
	}

	const imperfect = selectImperfectWave({
		verdicts,
		state,
		allSuites,
		scope: filtered,
		commitHash,
		uncommittedHash,
	})
	if (imperfect.action === 'run') {
		const plan = buildPlan(
			imperfect.goalKeys,
			verdicts,
			byKey,
			allSuites,
			imperfect.goalEvidenceByKey ?? new Map(),
			options.force,
			subtestFilterByKey,
		)
		return { selection: imperfect, plan, verdicts, fingerprints, continueLoop: true, filtered }
	}

	const outdated = selectOutdatedWave({
		verdicts,
		scope: filtered,
		allSuites,
		committedChangedByKey,
		commitHash,
		uncommittedHash,
		state,
	})
	if (outdated.action === 'run') {
		const plan = buildPlan(
			outdated.goalKeys,
			verdicts,
			byKey,
			allSuites,
			outdated.goalEvidenceByKey ?? new Map(),
			options.force,
			subtestFilterByKey,
		)
		return { selection: outdated, plan, verdicts, fingerprints, continueLoop: true, filtered }
	}

	const noisyKeys = listFreshNoisyKeys(verdicts, filtered)
	if (noisyKeys.length)
		return { error: 'noisyOnly', noisyKeys, code: 1, empty: true, continueLoop: true, filtered, verdicts, fingerprints }

	const skipKeys = skipBecauseSuiteKeys(filtered).filter(key => !probedSkip.has(key))
	if (skipKeys.length) {
		const plan = {
			slots: skipKeys.map(key => ({
				key,
				suite: byKey.get(key),
				action: 'run',
				goal: true,
			})),
			goalKeys: new Set(skipKeys),
		}
		return {
			selection: { action: 'run', mode: 'skip_because', goalKeys: new Set(skipKeys) },
			plan,
			verdicts,
			fingerprints,
			continueLoop: false,
			filtered,
		}
	}

	return { empty: true, code: 0, continueLoop: true, filtered, verdicts, fingerprints }
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
