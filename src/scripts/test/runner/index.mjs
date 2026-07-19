import 'fount/scripts/test/env.mjs'

import process from 'node:process'

import { console, geti18n, geti18nForTerminal } from '../../i18n/bare.mjs'
import { CPU_BUDGET_PCT } from '../core/baseline.mjs'
import {
	digestFileHashes,
	getHeadCommitHash,
	getUncommittedFiles,
	hashUncommittedFiles,
} from '../core/changed.mjs'
import { computeGlobalBudget } from '../core/concurrency.mjs'
import { reportDenoPanic } from '../core/deno_panic.mjs'
import { topoSortSuites } from '../core/dependencies.mjs'
import { buildEstimateTasksFromPlan, expectedRunDurationMs, summarizeEstimate } from '../core/estimate.mjs'
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
	resolveSerialOnlyFiles,
	validateSubtestFilters,
} from '../core/serial_files.mjs'
import {
	readState,
	refreshEntryFingerprint,
	suiteKey,
	upsertSuiteRun,
	writeState,
	writeStateMarkdown,
} from '../core/state.mjs'
import { auditTriggerCoverage } from '../core/trigger_audit.mjs'
import { buildVerdicts } from '../core/verdict.mjs'

import { buildReasonsFromPlan } from './continue_reason.mjs'
import { PlanRunCoordinator } from './dependency_scheduler.mjs'
import { exitCodeFromSlots, RunReportWriter } from './report.mjs'
import { ResourceRunGate } from './scheduler.mjs'
import {
	buildCommittedChangedByKey,
	scopeHasFreshNoisy,
	selectExplicitOrAll,
	selectImperfectWave,
	selectOutdatedWave,
} from './selection.mjs'
import { runSuite } from './suite_run.mjs'

/**
 * @typedef {{ manifestSelectors: string[], suiteSelectors: string[], subtestSelectors?: Record<string, string[]> }} GroupInput
 * @typedef {{ manifestIds: string[], suiteSelectors: string[], subtestSelectors: Record<string, string[]> }} ResolvedGroup
 * @typedef {object} RunTestsOptions
 * @property {boolean} [runAll]
 * @property {GroupInput[]} [groups]
 * @property {boolean} [noParallel]
 * @property {boolean} [force]
 */

/**
 * 将 CLI 分组输入解析为 manifest id 列表。
 * @param {GroupInput[]} groupInputs CLI 分组输入
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
			subtestSelectors: input.subtestSelectors ?? {},
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
 * 收集分组中未命中任何 suite 的指名。
 * @param {import('../core/manifest.mjs').SuiteDef[]} allSuites 全部 suite
 * @param {ResolvedGroup[]} groups 已解析分组
 * @returns {string[]} 如 `testkit:serial_files`
 */
function unmatchedSuiteSelectors(allSuites, groups) {
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
 * 从分组收集显式子测试过滤（suite 键 → 名列表）。
 * @param {ResolvedGroup[]} groups 已解析分组
 * @param {import('../core/manifest.mjs').SuiteDef[]} filtered 过滤后的 suite
 * @returns {Map<string, string[]>} 子测试过滤
 */
function collectSubtestFilterByKey(groups, filtered) {
	/** @type {Map<string, string[]>} */
	const map = new Map()
	for (const group of groups) 
		for (const [suiteName, subtests] of Object.entries(group.subtestSelectors ?? {})) {
			if (!subtests.length) continue
			for (const suite of filtered) {
				if (!group.manifestIds.includes(suite.manifestId)) continue
				if (suite.name !== suiteName && suite.id !== suiteName) continue
				const key = suiteKey(suite.manifestId, suite.name)
				const prev = map.get(key) ?? []
				map.set(key, [...new Set([...prev, ...subtests])])
			}
		}
	
	return map
}

/**
 * 根据 RunTestsOptions 拼出等效 CLI 命令串（日志/报告用）。
 * @param {RunTestsOptions} options 运行选项
 * @returns {string} 如 `fount test --force shells/chat`
 */
function buildTestCommand(options) {
	const parts = ['fount test']
	if (options.runAll) parts.push('--all')
	if (options.noParallel) parts.push('--no-parallel')
	if (options.force) parts.push('--force')
	if (options.groups?.length)
		for (const group of options.groups) {
			const manifest = group.manifestSelectors[0]
			if (group.suiteSelectors.length) {
				const bits = group.suiteSelectors.map(suite => {
					const subs = group.subtestSelectors?.[suite]
					return subs?.length ? `${suite}:${subs.join(',')}` : suite
				})
				parts.push(`${manifest}:${bits.join(',')}`)
			}
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
 * 将未命中任何文件的 trigger 警告打到控制台。
 * @param {import('../core/trigger_audit.mjs').TriggerWarning[]} warnings trigger 警告
 */
function logTriggerWarnings(warnings) {
	if (!warnings.length) return
	for (const warning of warnings) {
		const scope = warning.subtestName
			? `${warning.manifestId}/${warning.suiteName}/${warning.subtestName}`
			: `${warning.manifestId}/${warning.suiteName}`
		console.warnI18n('fountConsole.test.triggerNoMatch', { scope, pattern: warning.pattern })
	}
	console.warnI18n('fountConsole.test.triggerNoMatchSummary', { count: warnings.length })
}

/**
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
 * 执行单波 plan，更新 state；有失败返回非 0。
 * @param {object} context 运行上下文
 * @returns {Promise<number>} 退出码
 */
async function executeWave(context) {
	const {
		selection,
		verdicts,
		byKey,
		allSuites,
		state,
		commitHash,
		uncommittedHash,
		globalBudget,
		options,
		runId,
		command,
		subtestFilterByKey,
		triggerWarnings,
	} = context

	const goalKeys = selection.goalKeys ?? new Set()
	const plan = buildPlan(
		goalKeys,
		verdicts,
		byKey,
		allSuites,
		selection.goalEvidenceByKey ?? new Map(),
		options.force,
		subtestFilterByKey,
	)
	const continueReasons = buildReasonsFromPlan(plan)
	const runSlotCount = plan.slots.filter(slot => slot.action === 'run').length
	const reuseSlotCount = plan.slots.filter(slot => slot.action === 'reuse').length
	if (selection.mode === 'imperfect' || selection.mode === 'outdated' || selection.mode === 'explicit' || selection.mode === 'all')
		console.logI18n('fountConsole.test.planSlotSummary', {
			run: runSlotCount,
			reuse: reuseSlotCount,
			blocked: plan.slots.filter(slot => slot.action === 'blocked').length,
		})

	const reportWriter = new RunReportWriter({
		repoRoot: REPO_ROOT,
		planSlots: plan.slots,
		runId,
		command,
		commitHash,
		uncommittedHash,
		continueReasons: continueReasons.size ? continueReasons : undefined,
		triggerWarnings,
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
	 * @param {number | null} index report slot 下标
	 * @param {object} entry 写入 state/report 的条目
	 * @param {object} [root0] 选项
	 * @param {boolean} [root0.reused=false] 是否复用
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

	const failedFirstByManifest = selection.failedFirstByManifest ?? new Map()
	const streamLive = options.noParallel === true

	/** @type {number} */
	let exitCode = 1
	try {
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
				const subtestTriggerHashes = verdict?.subtests
					? Object.fromEntries(Object.entries(verdict.subtests).map(([name, sub]) => [name, sub.triggerHash ?? null]))
					: null
				refreshEntryFingerprint(state, key, commitHash, uncommittedHash, verdict?.triggerHash ?? null, subtestTriggerHashes)
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

			const subtests = slot.subtestsToRun
			/** @type {string[] | undefined} */
			let onlyFiles
			if (slot.fileFilters?.length) {
				const resolved = resolveSerialOnlyFiles(suite, slot.fileFilters, REPO_ROOT)
				onlyFiles = resolved.files
			}
			const baselineDurationMs = expectedRunDurationMs(suite, prev, subtests)
			const expected = formatExpectedDuration(baselineDurationMs)
			console.log(formatRunningSuiteMessage({
				manifestId: suite.manifestId,
				name: suite.name,
				heavy: !!suite.heavy,
				expected,
			}))
			console.log('>>', suite.run.join(' '))

			const firstMap = failedFirstByManifest.get(suite.manifestId)
			const firstFiles = firstMap?.has(suite.name) ? firstMap.get(suite.name) : undefined
			const result = await runSuite(suite, { firstFiles, subtests, onlyFiles }, globalBudget, streamLive, {
				label,
				baselineDurationMs,
			})
			printSuiteSummary(label, result, streamLive)

			if (suite.manifestId !== 'testkit')
				await reportDenoPanic({ repoRoot: REPO_ROOT, output: result.output, label, commitHash })
					.catch(error => console.error(error))

			/** @type {Record<string, string | null>} */
			const subtestTriggerHashes = {}
			if (suite.subtests?.length && verdict?.subtests)
				for (const st of suite.subtests)
					subtestTriggerHashes[st.name] = verdict.subtests[st.name]?.triggerHash ?? null

			const entry = await upsertSuiteRun({
				repoRoot: REPO_ROOT,
				state,
				suite,
				result,
				commitHash,
				uncommittedHash,
				triggerHash: verdict?.triggerHash ?? null,
				ranSubtests: subtests,
				subtestTriggerHashes,
			})
			await writeState(REPO_ROOT, state)
			if (index != null) await recordSuiteResult(index, entry)

			return { passed: result.passed }
		})
		exitCode = exitCodeFromSlots(reportWriter.slots)
	}
	finally {
		const finalReportPath = await reportWriter.finalize(exitCode)
		await writeStateMarkdown(REPO_ROOT, allSuites, state, buildStaleKeys(allSuites, verdicts, state))

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
	}

	return exitCode
}

/**
 * 将 fresh green/noisy 的条目指纹对齐到当前 HEAD（含脏→净 triggerHash）。
 * @param {import('../core/state.mjs').TestState} state 现状库
 * @param {import('../core/manifest.mjs').SuiteDef[]} allSuites 全部 suite
 * @param {Map<string, import('../core/verdict.mjs').Verdict>} verdicts 裁决表
 * @param {string} commitHash HEAD
 * @param {string | null} uncommittedHash 未提交 digest
 * @returns {boolean} 是否有写入
 */
function alignFreshFingerprints(state, allSuites, verdicts, commitHash, uncommittedHash) {
	let changed = false
	for (const suite of allSuites) {
		const key = suiteKey(suite.manifestId, suite.name)
		const verdict = verdicts.get(key)
		const entry = state.suites[key]
		if (!entry || !verdict?.fresh) continue
		if (verdict.kind !== 'green' && verdict.kind !== 'noisy') continue
		const needSuite = entry.commitHash !== commitHash
			|| (entry.uncommittedHash ?? null) !== uncommittedHash
			|| (entry.triggerHash ?? null) !== (verdict.triggerHash ?? null)
		let needSub = false
		const subtestTriggerHashes = verdict.subtests
			? Object.fromEntries(Object.entries(verdict.subtests).map(([name, sub]) => [name, sub.triggerHash ?? null]))
			: null
		if (entry.subtests && subtestTriggerHashes) 
			for (const [name, sub] of Object.entries(entry.subtests)) 
				if (sub.commitHash !== commitHash
					|| (sub.uncommittedHash ?? null) !== uncommittedHash
					|| (sub.triggerHash ?? null) !== (subtestTriggerHashes[name] ?? null)) {
					needSub = true
					break
				}
			
		
		if (!needSuite && !needSub) continue
		refreshEntryFingerprint(state, key, commitHash, uncommittedHash, verdict.triggerHash ?? null, subtestTriggerHashes)
		changed = true
	}
	return changed
}

/**
 * 测试运行主入口：选择 suite、调度执行、写报告与 state。
 *
 * 默认循环：imperfect 波次 → hard fail 即退 1；否则 outdated 波次 → 再回到 imperfect；
 * 两波皆空则按是否仍有 fresh noisy 退 1/0。失败不会在同一次调用内自动重试。
 * @param {RunTestsOptions} [options={}] 运行选项
 * @returns {Promise<number>} 进程退出码
 */
export async function runTests(options = {}) {
	const globalBudget = computeGlobalBudget()
	if (options.noParallel) globalBudget.cores = 1
	const runId = new Date().toISOString().replace(/[.:]/g, '-')
	const command = buildTestCommand(options)

	const allSuites = await loadAllSuites(REPO_ROOT)
	const triggerWarnings = await auditTriggerCoverage(REPO_ROOT, allSuites)
	logTriggerWarnings(triggerWarnings)
	const knownIds = listManifestIds(allSuites)
	const byKey = new Map(allSuites.map(s => [suiteKey(s.manifestId, s.name), s]))

	const [commitHash, uncommittedFiles, state] = await Promise.all([
		getHeadCommitHash(REPO_ROOT),
		getUncommittedFiles(REPO_ROOT),
		readState(REPO_ROOT),
	])
	const uncommittedHashes = await hashUncommittedFiles(REPO_ROOT, uncommittedFiles)
	const uncommittedHash = digestFileHashes(uncommittedHashes, uncommittedFiles)

	/** @type {string[] | undefined} */
	let manifestIds
	let filtered = allSuites
	let explicitSuites = false
	/** @type {Map<string, string[]>} */
	let subtestFilterByKey = new Map()

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
		const unknownSuites = unmatchedSuiteSelectors(allSuites, resolved)
		if (unknownSuites.length) {
			console.errorI18n('fountConsole.test.unknownSuiteSelector', { ids: unknownSuites.join(', ') })
			const scope = manifestIds?.length
				? allSuites.filter(s => manifestIds.includes(s.manifestId))
				: allSuites
			console.errorI18n('fountConsole.test.available', {
				ids: topoSortSuites(scope, allSuites).map(s => s.id).join(', '),
			})
			return 2
		}
		filtered = filterFromGroups(allSuites, resolved)
		subtestFilterByKey = collectSubtestFilterByKey(resolved, filtered)

		const filterErrors = validateSubtestFilters(subtestFilterByKey, byKey, REPO_ROOT)
		if (filterErrors.length) {
			for (const err of filterErrors) {
				const names = err.missing.join(', ')
				if (err.kind === 'subtest')
					console.errorI18n('fountConsole.test.unknownSubtestFilter', { suite: err.suiteId, names })
				else if (err.kind === 'file')
					console.errorI18n('fountConsole.test.unknownFileFilter', { suite: err.suiteId, names })
				else
					console.errorI18n('fountConsole.test.unsupportedSubtestFilter', { suite: err.suiteId, names })
			}
			return 2
		}

		if (options.groups.some(group => {
			const sel = group.manifestSelectors[0]
			const match = resolveManifestSelectors(group.manifestSelectors, knownIds, allSuites)
			return !knownIds.includes(sel) || match.manifestIds.length > 1
		}))
			console.logI18n('fountConsole.test.manifestMatched', { ids: manifestIds.join(', ') })
	}

	if (options.runAll || explicitSuites) {
		const selection = selectExplicitOrAll({
			filtered,
			state,
			manifestIds,
			runAll: options.runAll === true,
			subtestFilterByKey,
		})
		if (selection.action === 'exit') {
			if (explicitSuites) {
				console.logI18n('fountConsole.test.noMatchingSuites')
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
		console.logI18n('fountConsole.test.selectedSuites', {
			selected: selection.goalKeys.size,
			total: allSuites.length,
		})
		const committedChangedByKey = await buildCommittedChangedByKey(REPO_ROOT, allSuites, state)
		const verdicts = buildVerdicts(allSuites, state, committedChangedByKey, uncommittedHashes)
		return executeWave({
			selection,
			verdicts,
			byKey,
			allSuites,
			state,
			commitHash,
			uncommittedHash,
			globalBudget,
			options,
			runId,
			command,
			subtestFilterByKey,
			triggerWarnings,
		})
	}

	// 默认：imperfect → outdated 循环；hard fail 即退 1，两波皆空按 noisy 退
	for (; ;) {
		const committedChangedByKey = await buildCommittedChangedByKey(REPO_ROOT, allSuites, state)
		const verdicts = buildVerdicts(allSuites, state, committedChangedByKey, uncommittedHashes)
		if (alignFreshFingerprints(state, allSuites, verdicts, commitHash, uncommittedHash))
			await writeState(REPO_ROOT, state)

		const imperfect = selectImperfectWave({
			verdicts,
			state,
			allSuites,
			scope: filtered,
			commitHash,
			uncommittedHash,
		})
		if (imperfect.action === 'run') {
			console.logI18n('fountConsole.test.continueImperfect', { count: imperfect.goalKeys.size })
			console.logI18n('fountConsole.test.selectedSuites', {
				selected: imperfect.goalKeys.size,
				total: allSuites.length,
			})
			const code = await executeWave({
				selection: imperfect,
				verdicts,
				byKey,
				allSuites,
				state,
				commitHash,
				uncommittedHash,
				globalBudget,
				options,
				runId,
				command,
				subtestFilterByKey,
				triggerWarnings,
			})
			if (code !== 0) return code
			continue
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
			console.logI18n('fountConsole.test.outdatedSelected', { count: outdated.goalKeys.size })
			console.logI18n('fountConsole.test.selectedSuites', {
				selected: outdated.goalKeys.size,
				total: allSuites.length,
			})
			const code = await executeWave({
				selection: outdated,
				verdicts,
				byKey,
				allSuites,
				state,
				commitHash,
				uncommittedHash,
				globalBudget,
				options,
				runId,
				command,
				subtestFilterByKey,
				triggerWarnings,
			})
			if (code !== 0) return code
			continue
		}

		console.logI18n('fountConsole.test.nothingToContinue')
		return scopeHasFreshNoisy(verdicts, filtered) ? 1 : 0
	}
}
