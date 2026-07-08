import 'fount/scripts/test/env.mjs'

import process from 'node:process'

import { console, geti18n } from '../../i18n/bare.mjs'
import {
	digestFileHashes,
	getHeadCommitHash,
	getUncommittedFiles,
	hashUncommittedFiles,
	resolveChangedFiles,
} from '../core/changed.mjs'
import { computeGlobalBudget } from '../core/concurrency.mjs'
import { reportDenoPanic } from '../core/deno_panic.mjs'
import { topoSortSuites } from '../core/deps.mjs'
import {
	filterSuites,
	listManifestIds,
	loadAllSuites,
	resolveManifestSelectors,
} from '../core/manifest.mjs'
import { detectNoiseHits, stripNoiseMarkers } from '../core/output_filter.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import {
	computeSuiteTriggerHash,
	getSuiteBaselineDurationMs,
	isSuiteReusable,
	readState,
	refreshStateMarkdown,
	suiteKey,
	upsertSuiteRun,
	writeState,
} from '../core/state.mjs'

import {
	buildDiffSelectionReasons,
	stampExpansionReasons,
} from './continue_reason.mjs'
import { DependencyRunCoordinator } from './dependency_scheduler.mjs'
import { exitCodeFromSlots, RunReportWriter } from './report.mjs'
import { ResourceRunGate } from './scheduler.mjs'
import {
	buildChangedSinceRecordMap,
	finalizeSelection,
	rebuildReportSlotReasons,
	selectContinue,
	selectOutdated,
	selectSuites,
} from './selection.mjs'
import { runSuite } from './suite_run.mjs'

/**
 * @typedef {{ manifestSelectors: string[], suiteSelectors: string[] }} GroupInput
 * @typedef {{ manifestIds: string[], suiteSelectors: string[] }} ResolvedGroup
 * @typedef {object} RunTestsOptions
 * @property {boolean} [runAll]
 * @property {string} [since]
 * @property {GroupInput[]} [groups]
 * @property {boolean} [continueRun]
 * @property {boolean} [outdated]
 * @property {boolean} [noParallel]
 * @property {boolean} [force]
 */

/**
 * @param {GroupInput[]} groupInputs 原始分组
 * @param {string[]} knownIds 已知 manifest id
 * @param {import('../core/manifest.mjs').SuiteDef[]} allSuites 全部 suite
 * @returns {{ groups: ResolvedGroup[], unmatched: string[] }} 解析后的分组与未匹配项
 */
function resolveGroups(groupInputs, knownIds, allSuites) {
	/** @type {ResolvedGroup[]} */
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
		})
	}

	return { groups, unmatched }
}

/**
 * @param {import('../core/manifest.mjs').SuiteDef[]} allSuites 全部 suite
 * @param {ResolvedGroup[]} groups 解析后的分组
 * @returns {import('../core/manifest.mjs').SuiteDef[]} 去重后的 suite 列表
 */
function filterFromGroups(allSuites, groups) {
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
 * @param {RunTestsOptions} options 运行选项
 * @returns {string} 命令行摘要
 */
function buildTestCommand(options) {
	const parts = ['fount test']
	if (options.runAll) parts.push('--all')
	if (options.continueRun) parts.push('--continue')
	if (options.outdated) parts.push('--outdated')
	if (options.noParallel) parts.push('--no-parallel')
	if (options.force) parts.push('--force')
	if (options.since) parts.push('--since', options.since)
	if (options.groups?.length)
		for (const group of options.groups) {
			const manifest = group.manifestSelectors[0]
			if (group.suiteSelectors.length)
				parts.push(`${manifest}:${group.suiteSelectors.join(',')}`)
			else
				parts.push(manifest)
		}
	return parts.join(' ')
}

/**
 * @param {string} label suite 标签
 * @param {Awaited<ReturnType<typeof runSuite>>} result 运行结果
 * @param {boolean} [streamed] 输出是否已在运行期间实时转发
 */
function printSuiteSummary(label, result, streamed = false) {
	const noiseHits = detectNoiseHits(result.output)
	const noisy = noiseHits.length > 0
	if (result.terminated && result.terminateReason)
		console.errorI18n('fountConsole.test.terminated', {
			label,
			reason: result.terminateReason,
		})
	if (!streamed && (!result.passed || noisy)) process.stdout.write(stripNoiseMarkers(result.output))
	if (result.passed)
		console.log(noisy
			? geti18n('fountConsole.test.passedWithNoise', { label })
			: geti18n('fountConsole.test.passed', { label }))
	else if (result.terminated)
		console.error(geti18n('fountConsole.test.failed', { label }))
	else
		console.error(geti18n('fountConsole.test.failedWithCode', { label, code: result.exitCode }))
}

/**
 * @param {RunTestsOptions} options 运行选项
 * @returns {Promise<number>} 进程退出码
 */
export async function runTests(options = {}) {
	const globalBudget = computeGlobalBudget()
	const runId = new Date().toISOString().replace(/[.:]/g, '-')
	const command = buildTestCommand(options)

	const allSuites = await loadAllSuites(REPO_ROOT)
	const knownIds = listManifestIds(allSuites)

	const [commitHash, uncommittedFiles, state] = await Promise.all([
		getHeadCommitHash(REPO_ROOT),
		getUncommittedFiles(REPO_ROOT),
		readState(REPO_ROOT),
	])
	// 未提交文件内容只读一次：全局指纹与各 suite 的 trigger 复用指纹共享这张表。
	const uncommittedHashes = await hashUncommittedFiles(REPO_ROOT, uncommittedFiles)
	const uncommittedHash = digestFileHashes(uncommittedHashes, uncommittedFiles)

	// committedChangedByKey：仅 commit 层变更（复用判定用它区分「commit 命中 trigger」与
	// 「未提交内容变化」，避免把长期 dirty 但两次运行间未改动的文件误判为变更）。
	// changedSinceRecordByKey：再叠加未提交文件，供选择/outdated/continue 使用。
	const committedChangedByKey = await buildChangedSinceRecordMap(REPO_ROOT, allSuites, state)
	const changedSinceRecordByKey = new Map(
		[...committedChangedByKey].map(([key, files]) => [key, [...new Set([...files, ...uncommittedFiles])]]),
	)

	/** @type {string[] | undefined} */
	let manifestIds
	let filtered = allSuites
	let explicitSuites = false

	if (options.groups?.length) {
		const { groups: resolved, unmatched } = resolveGroups(options.groups, knownIds, allSuites)
		if (unmatched.length) {
			console.errorI18n('fountConsole.test.unknownManifestId', {
				ids: unmatched.join(', '),
			})
			console.errorI18n('fountConsole.test.available', { ids: knownIds.join(', ') })
			return 2
		}
		manifestIds = [...new Set(resolved.flatMap(group => group.manifestIds))]
		explicitSuites = resolved.some(group => group.suiteSelectors.length)
		filtered = filterFromGroups(allSuites, resolved)

		if (options.groups.some(group => {
			const sel = group.manifestSelectors[0]
			const match = resolveManifestSelectors(group.manifestSelectors, knownIds, allSuites)
			return !knownIds.includes(sel) || match.manifestIds.length > 1
		}))
			console.logI18n('fountConsole.test.manifestMatched', { ids: manifestIds.join(', ') })
	}

	/** @type {{ mode: string, files: string[] } | undefined} */
	let changedForReasons

	/** @type {Awaited<ReturnType<typeof selectSuites>>} */
	let selection
	if (options.continueRun) {
		selection = await selectContinue({
			repoRoot: REPO_ROOT,
			allSuites,
			state,
			commitHash,
			uncommittedHash,
			changedSinceRecordByKey,
		})
		if (selection.action === 'exit') {
			console.logI18n('fountConsole.test.nothingToContinue')
			return selection.code ?? 0
		}
		if (selection.mode === 'continue-pending')
			console.logI18n('fountConsole.test.continueResuming', { count: selection.suites.length })
		else if (selection.mode === 'continue-imperfect')
			console.logI18n('fountConsole.test.continueImperfect', { count: selection.suites.length })
	}
	else if (options.outdated) {
		selection = selectOutdated({
			allSuites,
			state,
			filtered,
			changedSinceRecordByKey,
		})
		console.logI18n('fountConsole.test.outdatedSelected', { count: selection.suites.length })
	}
	else {
		const changed = await resolveChangedFiles({
			repoRoot: REPO_ROOT,
			runAll: options.runAll,
			since: options.since,
		})
		changedForReasons = changed
		selection = await selectSuites({
			repoRoot: REPO_ROOT,
			allSuites,
			filtered,
			changed,
			runAll: options.runAll === true,
			manifestIds,
			explicitSuites,
			commitHash,
			uncommittedHash,
			uncommittedFiles,
			state,
			changedSinceRecordByKey,
		})
		if (selection.action === 'exit') return selection.code ?? 0
	}

	let selected = selection.suites ?? []
	console.logI18n('fountConsole.test.selectedSuites', {
		selected: selected.length,
		total: allSuites.length,
	})

	if (!selected.length) {
		console.logI18n('fountConsole.test.noMatchingSuites')
		if (explicitSuites) {
			const scope = manifestIds?.length
				? allSuites.filter(s => manifestIds.includes(s.manifestId))
				: allSuites
			console.errorI18n('fountConsole.test.available', {
				ids: topoSortSuites(scope, allSuites).map(s => s.id).join(', '),
			})
			return 2
		}
		return 0
	}

	const preExpansionKeys = new Set(selected.map(s => suiteKey(s.manifestId, s.name)))
	const preExpansionSuites = [...selected]
	const byKey = new Map(allSuites.map(s => [suiteKey(s.manifestId, s.name), s]))

	/** @type {Map<string, string>} */
	let expansionProvenance = new Map()
	if (selection.mode !== 'continue-pending') {
		const expanded = finalizeSelection(selected, allSuites, state, {
			commitHash,
			uncommittedHash,
			changedSinceRecordByKey,
			runGreenKeys: new Set(),
			byKey,
		}, { explicitSuites })
		selected = expanded.suites
		expansionProvenance = expanded.provenance
	}

	/** @type {Map<string, import('./continue_reason.mjs').ContinueReason>} */
	const continueReasons = new Map(selection.continueReasons ?? [])
	if (!explicitSuites && selection.mode === 'normal'
		&& changedForReasons?.mode === 'diff' && changedForReasons.files.length)
		for (const [key, reason] of buildDiffSelectionReasons(
			preExpansionSuites, changedForReasons.files, commitHash, uncommittedHash,
		))
			continueReasons.set(key, reason)

	if (selection.mode !== 'continue-pending')
		stampExpansionReasons(continueReasons, selected, preExpansionKeys, expansionProvenance, {
			explicitSuites,
			state,
			ctx: { commitHash, uncommittedHash, changedSinceRecordByKey, byKey },
		})

	let reportWriter = selection.reportWriter
	if (reportWriter?.slots.length) {
		const slotSuites = reportWriter.slots
			.map(slot => byKey.get(suiteKey(slot.manifestId, slot.name)))
			.filter(Boolean)
		if (slotSuites.length) {
			const { reasons } = rebuildReportSlotReasons({
				command: reportWriter.command ?? command,
				allSuites,
				slots: slotSuites,
				state,
				ctx: {
					commitHash,
					uncommittedHash,
					changedSinceRecordByKey,
					runGreenKeys: new Set(),
					byKey,
				},
			})
			for (const [key, reason] of reasons)
				continueReasons.set(key, reason)
		}
	}

	const runGreenKeys = new Set()
	const depCtx = {
		commitHash,
		uncommittedHash,
		changedSinceRecordByKey,
		runGreenKeys,
		byKey,
	}

	const streamLive = options.noParallel === true

	if (!reportWriter) {
		reportWriter = new RunReportWriter({
			repoRoot: REPO_ROOT,
			suites: selected,
			allSuites,
			runId,
			command,
			commitHash,
			uncommittedHash,
			continueReasons: continueReasons.size ? continueReasons : undefined,
		})
		const reportPath = await reportWriter.init()
		console.logI18n('fountConsole.test.reportPath', {
			path: reportPath.replace(/\\/g, '/'),
		})
	}
	else if (continueReasons.size) {
		reportWriter.command = command
		await reportWriter.stampContinueReasons(continueReasons)
	}

	/** @type {Map<string, number>} */
	const reportIndexByKey = new Map()
	for (let index = 0; index < reportWriter.slots.length; index++) {
		const slot = reportWriter.slots[index]
		reportIndexByKey.set(suiteKey(slot.manifestId, slot.name), index)
	}
	// 派发顺序对齐报告槽位（拓扑序）：coordinator 保持此顺序喂给 gate，
	// gate 串行时按 FIFO（即报告顺序）放行，并行时再按资源体量填箱。
	selected.sort((a, b) =>
		reportIndexByKey.get(suiteKey(a.manifestId, a.name))
		- reportIndexByKey.get(suiteKey(b.manifestId, b.name)))

	const gate = new ResourceRunGate(
		globalBudget.memBytes,
		suite => state.suites[suiteKey(suite.manifestId, suite.name)],
		{ serial: options.noParallel === true },
	)
	const coordinator = new DependencyRunCoordinator({
		suites: selected,
		state,
		ctx: depCtx,
		gate,
	})

	const retryByManifest = selection.retryByManifest ?? new Map()

	await coordinator.runAll(async outcome => {
		const { suite } = outcome
		const label = `${suite.manifestId}/${suite.name}`
		const index = reportIndexByKey.get(suiteKey(suite.manifestId, suite.name))

		if (outcome.kind === 'blocked') {
			console.errorI18n('fountConsole.test.blocked', {
				label,
				deps: outcome.blockedBy.join(', '),
			})
			const entry = await upsertSuiteRun({
				repoRoot: REPO_ROOT,
				state,
				suite,
				result: { passed: false, failedFiles: [], output: '', durationMs: 0 },
				blockedBy: outcome.blockedBy,
				commitHash,
				uncommittedHash,
			})
			await writeState(REPO_ROOT, state)
			if (index != null) await reportWriter.recordResult(index, entry)
			return { passed: false }
		}

		const key = suiteKey(suite.manifestId, suite.name)
		const prev = state.suites[key]
		const triggerHash = computeSuiteTriggerHash(suite, uncommittedHashes)
		if (isSuiteReusable(suite, prev, committedChangedByKey.get(key) ?? [], triggerHash, options.force)) {
			console.logI18n('fountConsole.test.reusedSuite', {
				manifestId: suite.manifestId,
				name: suite.name,
				status: prev.status,
			})
			if (index != null) await reportWriter.recordResult(index, prev, { reused: true })
			// 复用失败仍算失败 → 下游被 blocked；passed/noisy 计入 runGreenKeys 放行下游。
			return { passed: prev.status !== 'failed' }
		}

		const runningKey = suite.heavy
			? 'fountConsole.test.runningSuiteHeavy'
			: 'fountConsole.test.runningSuite'
		console.logI18n(runningKey, {
			manifestId: suite.manifestId,
			name: suite.name,
		})
		console.log('>>', suite.run.join(' '))

		const retryMap = retryByManifest.get(suite.manifestId)
		const onlyFiles = retryMap?.has(suite.name) ? retryMap.get(suite.name) : undefined
		const baselineDurationMs = getSuiteBaselineDurationMs(prev)
		const result = await runSuite(suite, onlyFiles, globalBudget, streamLive, {
			label,
			baselineDurationMs,
		})
		printSuiteSummary(label, result, streamLive)

		// testkit 自测会拿 panic 文本做 fixture，跳过以免误报上游 issue。
		if (suite.manifestId !== 'testkit')
			await reportDenoPanic({ repoRoot: REPO_ROOT, output: result.output, label, commitHash })
				.catch(error => console.error(error))

		const entry = await upsertSuiteRun({
			repoRoot: REPO_ROOT,
			state,
			suite,
			result,
			commitHash,
			uncommittedHash,
			triggerHash,
		})
		await writeState(REPO_ROOT, state)
		if (index != null) await reportWriter.recordResult(index, entry)

		return { passed: result.passed }
	})

	const exitCode = exitCodeFromSlots(reportWriter.slots)
	const reportPath = await reportWriter.finalize(exitCode)
	await refreshStateMarkdown(REPO_ROOT, allSuites, state, uncommittedFiles)
	console.logI18n('fountConsole.test.reportPathFinal', {
		path: reportPath.replace(/\\/g, '/'),
	})
	console.logI18n('fountConsole.test.statePathFinal', {
		path: 'data/test/state/main.md',
	})

	return exitCode
}
