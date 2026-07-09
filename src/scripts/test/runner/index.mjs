import 'fount/scripts/test/env.mjs'

import process from 'node:process'

import { console, geti18n, geti18nForTerminal } from '../../i18n/bare.mjs'
import { CPU_BUDGET_PCT } from '../core/baseline.mjs'
import {
	digestFileHashes,
	getHeadCommitHash,
	getUncommittedFiles,
	hashUncommittedFiles,
	resolveChangedFiles,
} from '../core/changed.mjs'
import { computeGlobalBudget } from '../core/concurrency.mjs'
import { reportDenoPanic } from '../core/deno_panic.mjs'
import { topoSortSuites } from '../core/dependencies.mjs'
import { buildEstimateTasksFromPlan, summarizeEstimate } from '../core/estimate.mjs'
import { formatDuration } from '../core/format_duration.mjs'
import {
	filterSuites,
	listManifestIds,
	loadAllSuites,
	resolveManifestSelectors,
} from '../core/manifest.mjs'
import { detectNoiseHits, stripNoiseMarkers } from '../core/output_filter.mjs'
import { buildPlan } from '../core/plan.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import { formatExpectedDuration, formatParallelRatePct } from '../core/run_timing.mjs'
import {
	getSuiteBaselineDurationMs,
	readState,
	refreshEntryFingerprint,
	refreshStateMarkdown,
	suiteKey,
	upsertSuiteRun,
	writeState,
} from '../core/state.mjs'
import { buildVerdicts } from '../core/verdict.mjs'

import { buildReasonsFromPlan } from './continue_reason.mjs'
import { PlanRunCoordinator } from './dependency_scheduler.mjs'
import { exitCodeFromSlots, RunReportWriter } from './report.mjs'
import { ResourceRunGate } from './scheduler.mjs'
import {
	buildCommittedChangedByKey,
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
 * 将 CLI 分组输入解析为 manifest id 列表。
 * @param {import('../cli.mjs').GroupInput[]} groupInputs CLI 分组输入
 * @param {string[]} knownIds 已知 manifest id
 * @param {import('../core/manifest.mjs').SuiteDef[]} allSuites 全部 suite
 * @returns {{ groups: ResolvedGroup[], unmatched: string[] }} 已解析分组与未匹配 id
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
 * 按多组 manifest/suite 选择器过滤并去重 suite。
 * @param {import('../core/manifest.mjs').SuiteDef[]} allSuites 全部 suite
 * @param {ResolvedGroup[]} groups 已解析分组
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
 * 根据 RunTestsOptions 拼出等效 CLI 命令串（日志/报告用）。
 * @param {RunTestsOptions} options 运行选项
 * @returns {string} 如 `fount test --continue shells/chat`
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
 * 打印单个 suite 的通过/失败/噪声摘要。
 * @param {string} label 展示标签（manifest:suite）
 * @param {import('./suite_run.mjs').SuiteRunResult} result 子进程结果
 * @param {boolean} [streamed=false] 输出是否已实时打印
 * @returns {void}
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
 * 格式化「正在运行」控制台行（含 heavy/预期耗时后缀）。
 * @param {object} root0 suite 元数据
 * @param {string} root0.manifestId manifest id
 * @param {string} root0.name suite 名
 * @param {boolean} [root0.heavy] 是否 heavy
 * @param {string} [root0.expected] 预期耗时展示串
 * @returns {string} 本地化运行提示
 */
function formatRunningSuiteMessage({ manifestId, name, heavy, expected }) {
	let msg = geti18nForTerminal('fountConsole.test.runningSuite.base', { manifestId, name })
	/** @type {string[]} */
	const parts = []
	if (heavy) parts.push(geti18nForTerminal('fountConsole.test.runningSuite.heavy'))
	if (expected) parts.push(geti18nForTerminal('fountConsole.test.runningSuite.expected', { expected }))
	if (parts.length) msg += `（${parts.join('，')}）`
	return msg
}

/**
 * 打印待完成 slot 的 ETA 估算。
 * @param {import('./report.mjs').ReportWriter} reportWriter 报告写入器
 * @returns {void}
 */
function logPendingEstimate(reportWriter) {
	const estimate = reportWriter.summarizePendingEstimate()
	if (!estimate || !estimate.runCount) return
	const completed = reportWriter.slots.filter(slot => slot.state === 'done').length
	console.logI18n('fountConsole.test.estimatedRemaining', {
		eta: formatDuration(estimate.etaMs),
		completed,
		total: reportWriter.slots.length,
	})
}

/**
 * 找出 verdict 未知但 state 仍标 passed 的陈旧 suite 键。
 * @param {import('../core/manifest.mjs').SuiteDef[]} allSuites 全部 suite
 * @param {Map<string, import('../core/verdict.mjs').Verdict>} verdicts 当前裁决
 * @param {import('../core/state.mjs').TestState} state 现状库
 * @returns {Set<string>} 需标陈旧的 suite 键
 */
function buildStaleKeys(allSuites, verdicts, state) {
	return new Set(allSuites
		.filter(suite => {
			const key = suiteKey(suite.manifestId, suite.name)
			const verdict = verdicts.get(key)
			return verdict?.kind === 'unknown' && state.suites[key]?.status === 'passed'
		})
		.map(suite => suiteKey(suite.manifestId, suite.name)))
}

/**
 * 测试运行主入口：选择 suite、调度执行、写报告与 state。
 * @param {RunTestsOptions} [options={}] 运行选项
 * @returns {Promise<number>} 进程退出码
 */
export async function runTests(options = {}) {
	const globalBudget = computeGlobalBudget()
	// --no-parallel：套件串行的同时把 serial.mjs 内文件并发压到 1，避免 Windows 抢 node_modules 锁
	if (options.noParallel) globalBudget.cores = 1
	const runId = new Date().toISOString().replace(/[.:]/g, '-')
	const command = buildTestCommand(options)

	const allSuites = await loadAllSuites(REPO_ROOT)
	const knownIds = listManifestIds(allSuites)
	const byKey = new Map(allSuites.map(s => [suiteKey(s.manifestId, s.name), s]))

	const [commitHash, uncommittedFiles, state] = await Promise.all([
		getHeadCommitHash(REPO_ROOT),
		getUncommittedFiles(REPO_ROOT),
		readState(REPO_ROOT),
	])
	const uncommittedHashes = await hashUncommittedFiles(REPO_ROOT, uncommittedFiles)
	const uncommittedHash = digestFileHashes(uncommittedHashes, uncommittedFiles)
	const committedChangedByKey = await buildCommittedChangedByKey(REPO_ROOT, allSuites, state)
	const verdicts = buildVerdicts(allSuites, state, committedChangedByKey, uncommittedHashes)

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

	/** @type {import('./selection.mjs').GoalSelection} */
	let selection
	if (options.continueRun) {
		selection = selectContinue({
			verdicts,
			state,
			commitHash,
			uncommittedHash,
			committedChangedByKey,
		})
		if (selection.action === 'exit') {
			console.logI18n('fountConsole.test.nothingToContinue')
			return selection.code ?? 0
		}
		console.logI18n('fountConsole.test.continueImperfect', { count: selection.goalKeys.size })
	}
	else if (options.outdated) {
		selection = selectOutdated({ verdicts, filtered })
		console.logI18n('fountConsole.test.outdatedSelected', { count: selection.goalKeys.size })
	}
	else {
		const changed = await resolveChangedFiles({
			repoRoot: REPO_ROOT,
			runAll: options.runAll,
			since: options.since,
		})
		selection = selectSuites({
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
		})
		if (selection.action === 'exit') return selection.code ?? 0
	}

	const goalKeys = selection.goalKeys ?? new Set()
	console.logI18n('fountConsole.test.selectedSuites', {
		selected: goalKeys.size,
		total: allSuites.length,
	})

	if (!goalKeys.size) {
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

	const plan = buildPlan(
		goalKeys,
		verdicts,
		byKey,
		allSuites,
		selection.goalEvidenceByKey ?? new Map(),
		options.force,
	)
	const continueReasons = buildReasonsFromPlan(plan)

	const reportWriter = new RunReportWriter({
		repoRoot: REPO_ROOT,
		planSlots: plan.slots,
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

	const reportIndexByKey = new Map(plan.slots.map((slot, index) => [slot.key, index]))
	const estimateSerial = options.noParallel === true
	const estimateTasks = buildEstimateTasksFromPlan(plan.slots, state)
	const estimatePlan = new Map(estimateTasks.map(task => [task.key, task]))
	const estimateOptions = {
		serial: estimateSerial,
		memBudgetBytes: globalBudget.memBytes,
		cpuBudgetPct: CPU_BUDGET_PCT,
	}
	await reportWriter.setEstimatePlan(estimatePlan, estimateOptions)

	if (estimateTasks.length) {
		const estimate = summarizeEstimate(estimateTasks, estimateOptions)
		if (estimate.runCount) {
			if (estimateSerial) {
				console.logI18n('fountConsole.test.estimatedRunSerial', {
					eta: formatDuration(estimate.etaMs),
				})
				if (Math.abs(estimate.savingsMs) > 100)
					console.logI18n('fountConsole.test.estimatedRunSerialHint', {
						eta: formatDuration(estimate.parallelEtaMs),
						rate: formatParallelRatePct(estimate.parallelRatePct),
						savings: formatDuration(estimate.savingsMs),
					})
			}
			else
				console.logI18n('fountConsole.test.estimatedRun', {
					eta: formatDuration(estimate.etaMs),
					rate: formatParallelRatePct(estimate.parallelRatePct),
				})
			if (estimate.reusedCount || estimate.blockedCount)
				console.logI18n('fountConsole.test.estimatedRunSkipped', {
					reused: estimate.reusedCount,
					blocked: estimate.blockedCount,
				})
		}
		else
			console.logI18n('fountConsole.test.noRealRunPlanned', {
				reused: estimate.reusedCount,
				blocked: estimate.blockedCount,
			})
	}

	/**
	 * 记录 slot 结果并可选打印剩余 ETA。
	 * @param {number | null} index report slot 下标
	 * @param {object} entry 写入 state/report 的条目
	 * @param {object} [root0] 选项
	 * @param {boolean} [root0.reused=false] 是否为复用（非真跑）
	 * @param {boolean} [root0.logEstimate=true] 是否打印 ETA
	 * @returns {Promise<void>}
	 */
	const recordSuiteResult = async (index, entry, { reused = false, logEstimate = true } = {}) => {
		if (index != null) await reportWriter.recordResult(index, entry, { reused })
		if (logEstimate) logPendingEstimate(reportWriter)
	}

	const gate = new ResourceRunGate(
		globalBudget.memBytes,
		suite => state.suites[suiteKey(suite.manifestId, suite.name)],
		{ serial: options.noParallel === true },
	)
	const coordinator = new PlanRunCoordinator({
		slots: plan.slots,
		state,
		gate,
	})

	const retryByManifest = selection.retryByManifest ?? new Map()
	const streamLive = options.noParallel === true

	await coordinator.runAll(async slot => {
		const { suite } = slot
		const label = `${suite.manifestId}/${suite.name}`
		const key = slot.key
		const index = reportIndexByKey.get(key)
		const prev = state.suites[key]
		const verdict = verdicts.get(key)

		if (slot.action === 'reuse') {
			console.logI18n('fountConsole.test.reusedSuite', {
				manifestId: suite.manifestId,
				name: suite.name,
				status: prev.status,
			})
			refreshEntryFingerprint(state, key, commitHash, uncommittedHash, verdict?.triggerHash ?? null)
			await writeState(REPO_ROOT, state)
			if (index != null) await recordSuiteResult(index, prev, { reused: true, logEstimate: false })
			return { passed: prev.status !== 'failed' }
		}

		if (slot.action === 'blocked') {
			console.errorI18n('fountConsole.test.blocked', {
				label,
				deps: slot.blockedBy.join(', '),
			})
			const entry = await upsertSuiteRun({
				repoRoot: REPO_ROOT,
				state,
				suite,
				result: { passed: false, failedFiles: [], output: '', durationMs: 0 },
				blockedBy: slot.blockedBy,
				commitHash,
				uncommittedHash,
			})
			await writeState(REPO_ROOT, state)
			if (index != null) await recordSuiteResult(index, entry, { logEstimate: false })
			return { passed: false }
		}

		const baselineDurationMs = getSuiteBaselineDurationMs(prev)
		const expected = formatExpectedDuration(baselineDurationMs)
		console.log(formatRunningSuiteMessage({
			manifestId: suite.manifestId,
			name: suite.name,
			heavy: !!suite.heavy,
			expected,
		}))
		console.log('>>', suite.run.join(' '))

		const retryMap = retryByManifest.get(suite.manifestId)
		const onlyFiles = retryMap?.has(suite.name) ? retryMap.get(suite.name) : undefined
		const result = await runSuite(suite, onlyFiles, globalBudget, streamLive, {
			label,
			baselineDurationMs,
		})
		printSuiteSummary(label, result, streamLive)

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
			triggerHash: verdict?.triggerHash ?? null,
		})
		await writeState(REPO_ROOT, state)
		if (index != null) await recordSuiteResult(index, entry)

		return { passed: result.passed }
	})

	const exitCode = exitCodeFromSlots(reportWriter.slots)
	const finalReportPath = await reportWriter.finalize(exitCode)
	await refreshStateMarkdown(REPO_ROOT, allSuites, state, buildStaleKeys(allSuites, verdicts, state))

	const completedSlots = reportWriter.slots.filter(slot => slot.state === 'done')
	if (exitCode !== 0 && completedSlots.length
		&& completedSlots.every(slot => slot.reused || slot.status === 'blocked'))
		console.logI18n('fountConsole.test.allReusedHint')

	console.logI18n('fountConsole.test.reportPathFinal', {
		path: finalReportPath.replace(/\\/g, '/'),
	})
	console.logI18n('fountConsole.test.statePathFinal', {
		path: 'data/test/state/main.md',
	})

	return exitCode
}
