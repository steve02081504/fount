import 'fount/scripts/test/env.mjs'

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import process from 'node:process'

import { console, geti18n } from '../../i18n.mjs'
import { computeUncommittedHash, getUncommittedFiles, resolveChangedFiles } from '../core/changed.mjs'
import {
	applyBudgetToEnv,
	computeConcurrency,
	computeGlobalBudget,
	SUITE_MEM,
} from '../core/concurrency.mjs'
import {
	mergeSuiteResult,
	readFailures,
	writeFailures,
} from '../core/failures.mjs'
import {
	filterSuites,
	listManifestIds,
	loadAllSuites,
	resolveManifestSelectors,
} from '../core/manifest.mjs'
import { detectNoiseHits, filterTestOutput, stripNoiseMarkers } from '../core/output_filter.mjs'
import { failureFilePath } from '../core/paths.mjs'
import { readFailuresOutFile, toRepoRelative } from '../core/protocol.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import {
	loadTimingsForSuites,
	recordSuiteSuccessTiming,
	writeTimings,
} from '../core/timings.mjs'

import { TestReportWriter } from './report.mjs'
import { runCommand } from './run_command.mjs'
import { SuiteRunGate } from './scheduler.mjs'
import { selectSuites, shouldTrackFailures } from './selection.mjs'

/**
 * CLI 传入的分组指名。
 * @typedef {{ manifestSelectors: string[], suiteSelectors: string[] }} GroupInput
 */

/**
 * 解析后的分组。
 * @typedef {{ manifestIds: string[], suiteSelectors: string[] }} ResolvedGroup
 */

/**
 * runTests 入口选项。
 * @typedef {object} RunTestsOptions
 * @property {boolean} [runAll] 全量
 * @property {string} [since] diff 基准 commit
 * @property {GroupInput[]} [groups] 分组指名
 * @property {boolean} [genReport] 生成 data/test/report
 * @property {boolean} [continueRun] 续跑未完成项
 * @property {number} [jobs] 全局并发上限
 */

/**
 * 将 CLI 分组解析为 manifest id 列表。
 * @param {GroupInput[]} groupInputs 原始分组
 * @param {string[]} knownIds 已知 manifest id
 * @returns {{ groups: ResolvedGroup[], unmatched: string[] }} 解析后的分组与未匹配项
 */
function resolveGroups(groupInputs, knownIds) {
	/** @type {ResolvedGroup[]} */
	const groups = []
	/** @type {string[]} */
	const unmatched = []

	for (const input of groupInputs) {
		const resolved = resolveManifestSelectors(input.manifestSelectors, knownIds)
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
 * 从解析后的分组过滤 suite 并去重。
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
 * 构造报告/日志用的命令行摘要。
 * @param {RunTestsOptions} options 运行选项
 * @returns {string} 命令行摘要
 */
function buildTestCommand(options) {
	const parts = ['fount test']
	if (options.runAll) parts.push('--all')
	if (options.genReport) parts.push('--gen-report')
	if (options.continueRun) parts.push('--continue')
	if (options.jobs >= 1) parts.push('-j', String(options.jobs))
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
 * 构造 suite 运行命令与环境变量。
 * @param {import('../core/manifest.mjs').SuiteDef} suite suite 定义
 * @param {string[] | undefined} onlyFiles 仅跑这些文件
 * @param {string} failuresOut 失败输出临时文件
 * @param {import('../core/concurrency.mjs').GlobalBudget | undefined} globalBudget 全局预算
 * @returns {{ command: string[], env: Record<string, string> }} 命令与环境
 */
function buildSuiteInvocation(suite, onlyFiles, failuresOut, globalBudget) {
	const env = {
		FOUNT_TEST: '1',
		FOUNT_TEST_KEEP_GOING: '1',
		FOUNT_TEST_FAILURES_OUT: failuresOut,
		FOUNT_TEST_SCOPE: suite.manifestId,
		FOUNT_TEST_ONLY: onlyFiles?.length ? onlyFiles.join('\n') : '',
	}
	if (suite.heavy && globalBudget)
		applyBudgetToEnv(env, globalBudget)
	return { command: [...suite.run], env }
}

/**
 * 运行单个 suite 并返回结果。
 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
 * @param {string[] | undefined} onlyFiles 失败重跑文件过滤
 * @param {import('../core/concurrency.mjs').GlobalBudget | undefined} globalBudget 全局预算
 * @param {boolean} [stream] 是否实时转发 stdout/stderr
 * @param {object} [watchdog] watchdog 选项
 * @param {string} [watchdog.label] suite 标签
 * @param {number | undefined} [watchdog.baselineDurationMs] 上次成功耗时
 * @returns {Promise<{ passed: boolean, failedFiles: string[], output: string, durationMs: number, terminated?: boolean, terminateReason?: string }>} 运行结果
 */
async function runSuite(suite, onlyFiles, globalBudget, stream = false, watchdog = {}) {
	const tempDir = await mkdtemp(join(tmpdir(), 'fount-test-'))
	const failuresOut = join(tempDir, 'failures.json')
	const started = Date.now()
	try {
		const { command, env } = buildSuiteInvocation(suite, onlyFiles, failuresOut, globalBudget)
		const { code, output: rawOutput, terminated, terminateReason } = await runCommand(command, env, {
			stream,
			cwd: REPO_ROOT,
			label: watchdog.label,
			baselineDurationMs: watchdog.baselineDurationMs,
		})
		return {
			passed: code === 0 && !terminated,
			failedFiles: (await readFailuresOutFile(failuresOut)).map(file => toRepoRelative(REPO_ROOT, file)),
			output: filterTestOutput(rawOutput),
			durationMs: Date.now() - started,
			terminated,
			terminateReason,
		}
	}
	finally {
		await rm(tempDir, { recursive: true, force: true })
	}
}

/**
 * 打印单个 suite 运行结果摘要。
 * @param {string} label suite 标签
 * @param {Awaited<ReturnType<typeof runSuite>>} result 运行结果
 * @param {boolean} genReport 是否生成报告模式
 * @param {boolean} [streamed] 输出是否已在运行期间实时转发
 */
function printSuiteSummary(label, result, genReport, streamed = false) {
	const noiseHits = detectNoiseHits(result.output)
	const noisy = noiseHits.length > 0
	if (result.terminated && result.terminateReason)
		console.errorI18n('fountConsole.test.terminated', {
			label,
			reason: result.terminateReason,
		})
	if (genReport) {
		const parts = [
			result.passed
				? geti18n('fountConsole.test.passedLabel')
				: geti18n('fountConsole.test.failedLabel'),
			label,
		]
		if (noisy) parts.push(geti18n('fountConsole.test.noiseHits', {
			hits: noiseHits.join(', '),
		}))
		const line = parts.join(': ')
		if (result.passed) console.log(line)
		else console.error(line)
		return
	}
	if (!streamed && (!result.passed || noisy)) process.stdout.write(stripNoiseMarkers(result.output))
	if (result.passed)
		console.log(noisy
			? geti18n('fountConsole.test.passedWithNoise', { label })
			: geti18n('fountConsole.test.passed', { label }))
	else
		console.error(geti18n('fountConsole.test.failed', { label }))
}

/**
 * @param {import('./report.mjs').ReportSuiteSlot[]} entries 报告条目
 * @returns {number} 退出码
 */
function exitCodeFromEntries(entries) {
	const completed = entries.filter(e => !('pending' in e))
	return completed.some(e => !e.passed) ? 1 : 0
}

/**
 * 主测试入口。
 * @param {RunTestsOptions} options 运行选项
 * @returns {Promise<number>} 进程退出码（0 为通过）
 */
export async function runTests(options = {}) {
	const genReport = options.genReport === true || options.continueRun === true
	const globalBudget = computeGlobalBudget(options.jobs)
	const runId = new Date().toISOString().replace(/[.:]/g, '-')

	const allSuites = await loadAllSuites(REPO_ROOT)
	const knownIds = listManifestIds(allSuites)

	const [currentHash, uncommittedFiles] = await Promise.all([
		computeUncommittedHash(REPO_ROOT),
		getUncommittedFiles(REPO_ROOT),
	])

	if (options.continueRun)
		return runContinue({
			allSuites,
			genReport,
			globalBudget,
			currentHash,
			jobs: options.jobs,
		})

	const changed = await resolveChangedFiles({
		repoRoot: REPO_ROOT,
		runAll: options.runAll,
		since: options.since,
	})

	/** @type {string[] | undefined} */
	let manifestIds
	let filtered = allSuites
	let explicitSuites = false

	if (options.groups?.length) {
		const { groups: resolved, unmatched } = resolveGroups(options.groups, knownIds)
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
			const match = resolveManifestSelectors(group.manifestSelectors, knownIds)
			return !knownIds.includes(sel) || match.manifestIds.length > 1
		}))
			console.logI18n('fountConsole.test.manifestMatched', { ids: manifestIds.join(', ') })
	}

	const trackFailures = shouldTrackFailures(manifestIds)

	const selection = await selectSuites({
		repoRoot: REPO_ROOT,
		allSuites,
		filtered,
		changed,
		runAll: options.runAll === true,
		manifestIds,
		explicitSuites,
		currentHash,
		uncommittedFiles,
	})
	if (selection.action === 'exit') return selection.code ?? 0

	const { suites: selected, retryByManifest, usingFailureRetry } = selection

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
				ids: scope.map(s => s.id).join(', '),
			})
			return 2
		}
		return 0
	}

	const streamLive = !genReport && selected.length === 1
	const timingsByManifest = await loadTimingsForSuites(REPO_ROOT, selected)
	const timingsDirty = new Set()
	const manifestFailures = new Map()
	let exitCode = 0

	const suiteConcurrency = computeConcurrency(
		SUITE_MEM,
		Number(process.env.FOUNT_TEST_SUITE_CONCURRENCY) || options.jobs,
	)
	const gate = new SuiteRunGate(suiteConcurrency)
	/** @type {{ suite: import('../core/manifest.mjs').SuiteDef, result: Awaited<ReturnType<typeof runSuite>> }[]} */
	const suiteResults = new Array(selected.length)
	let cursor = 0

	/** @type {TestReportWriter | null} */
	let reportWriter = null
	if (genReport) {
		reportWriter = new TestReportWriter({
			repoRoot: REPO_ROOT,
			suites: selected,
			runId,
			command: buildTestCommand(options),
		})
		const reportPath = await reportWriter.init()
		console.logI18n('fountConsole.test.reportPath', {
			path: reportPath.replace(/\\/g, '/'),
		})
	}

	/**
	 * @returns {Promise<void>}
	 */
	async function suiteWorker() {
		while (cursor < selected.length) {
			const index = cursor++
			const suite = selected[index]
			const release = await gate.acquire(suite)
			try {
				const runningKey = suite.heavy
					? 'fountConsole.test.runningSuiteHeavy'
					: 'fountConsole.test.runningSuite'
				console.logI18n(runningKey, {
					manifestId: suite.manifestId,
					name: suite.name,
				})
				if (!genReport) console.log('>>', suite.run.join(' '))
				const retryMap = retryByManifest.get(suite.manifestId)
				const onlyFiles = retryMap?.has(suite.name) ? retryMap.get(suite.name) : undefined
				const label = `${suite.manifestId}/${suite.name}`
				const baselineDurationMs = timingsByManifest.get(suite.manifestId)?.items?.[suite.name]?.durationMs
				const result = await runSuite(suite, onlyFiles, globalBudget, streamLive, {
					label,
					baselineDurationMs,
				})
				printSuiteSummary(label, result, genReport, streamLive)
				suiteResults[index] = { suite, result }
				if (reportWriter)
					await reportWriter.recordResult(index, {
						suite,
						passed: result.passed,
						failedFiles: result.failedFiles,
						output: result.output,
						durationMs: result.durationMs,
						terminated: result.terminated,
						terminateReason: result.terminateReason,
					})
			}
			finally {
				release()
			}
		}
	}

	await Promise.all(Array.from(
		{ length: Math.min(suiteConcurrency, selected.length) },
		() => suiteWorker(),
	))

	for (const { suite, result } of suiteResults) {
		if (!result.passed) exitCode = 1

		if (result.passed) {
			const record = timingsByManifest.get(suite.manifestId) ?? { items: {} }
			timingsByManifest.set(
				suite.manifestId,
				recordSuiteSuccessTiming(record, suite.name, result.durationMs),
			)
			timingsDirty.add(suite.manifestId)
		}

		if (trackFailures || usingFailureRetry) {
			if (!manifestFailures.has(suite.manifestId))
				manifestFailures.set(suite.manifestId,
					(await readFailures(REPO_ROOT, suite.manifestId))?.items ?? [])
			manifestFailures.set(suite.manifestId, mergeSuiteResult(
				manifestFailures.get(suite.manifestId),
				suite.name,
				result.passed,
				result.failedFiles.length ? result.failedFiles : undefined,
			))
		}
	}

	if (trackFailures || usingFailureRetry) {
		const idsToWrite = new Set([
			...manifestFailures.keys(),
			...usingFailureRetry ? retryByManifest.keys() : [],
		])
		for (const manifestId of idsToWrite) {
			const items = manifestFailures.get(manifestId) ?? []
			await writeFailures(REPO_ROOT, manifestId, items, currentHash)
			if (items.length)
				console.logI18n('fountConsole.test.failuresSaved', {
					path: relative(REPO_ROOT, failureFilePath(REPO_ROOT, manifestId)).replace(/\\/g, '/'),
					count: items.length,
				})
			else if (retryByManifest.has(manifestId))
				console.logI18n('fountConsole.test.failuresCleared', { manifestId })
		}
	}

	for (const manifestId of timingsDirty)
		await writeTimings(REPO_ROOT, manifestId, timingsByManifest.get(manifestId) ?? { items: {} })

	if (reportWriter) {
		const reportPath = await reportWriter.finalize(exitCode)
		console.logI18n('fountConsole.test.reportPathFinal', {
			path: reportPath.replace(/\\/g, '/'),
		})
	}

	return exitCode
}

/**
 * 续跑 report.json 中 pending 的 suite。
 * @param {object} params 参数
 * @param {import('../core/manifest.mjs').SuiteDef[]} params.allSuites 全部 suite
 * @param {boolean} params.genReport 是否写报告
 * @param {import('../core/concurrency.mjs').GlobalBudget | undefined} params.globalBudget 全局预算
 * @param {string | null} params.currentHash 当前未提交 digest
 * @param {number | undefined} params.jobs 并发上限
 * @returns {Promise<number>} 进程退出码
 */
async function runContinue({ allSuites, genReport, globalBudget, currentHash, jobs }) {
	const resumed = await TestReportWriter.resume(REPO_ROOT)
	if (!resumed?.pendingIndices.length) {
		console.logI18n('fountConsole.test.nothingToContinue')
		return 0
	}

	const { writer: reportWriter, pendingIndices } = resumed
	/** @type {{ suite: import('../core/manifest.mjs').SuiteDef, index: number }[]} */
	const pendingRuns = []
	for (const pending of pendingIndices) {
		const suite = allSuites.find(s =>
			s.manifestId === pending.manifestId && s.name === pending.name,
		)
		if (suite) pendingRuns.push({ suite, index: pending.index })
	}

	if (!pendingRuns.length) {
		console.logI18n('fountConsole.test.nothingToContinue')
		return 0
	}

	console.logI18n('fountConsole.test.continueResuming', { count: pendingRuns.length })

	const manifestIds = [...new Set(reportWriter.entries.map(entry => entry.manifestId))]
	const trackFailures = shouldTrackFailures(manifestIds)
	const timingsByManifest = await loadTimingsForSuites(REPO_ROOT, pendingRuns.map(p => p.suite))
	const timingsDirty = new Set()
	const manifestFailures = new Map()
	const retryByManifest = new Map()

	const suiteConcurrency = computeConcurrency(
		SUITE_MEM,
		Number(process.env.FOUNT_TEST_SUITE_CONCURRENCY) || jobs,
	)
	const gate = new SuiteRunGate(suiteConcurrency)
	let cursor = 0

	/**
	 * @returns {Promise<void>}
	 */
	async function suiteWorker() {
		while (cursor < pendingRuns.length) {
			const runIndex = cursor++
			const { suite, index } = pendingRuns[runIndex]
			const release = await gate.acquire(suite)
			try {
				const runningKey = suite.heavy
					? 'fountConsole.test.runningSuiteHeavy'
					: 'fountConsole.test.runningSuite'
				console.logI18n(runningKey, {
					manifestId: suite.manifestId,
					name: suite.name,
				})
				const label = `${suite.manifestId}/${suite.name}`
				const baselineDurationMs = timingsByManifest.get(suite.manifestId)?.items?.[suite.name]?.durationMs
				const result = await runSuite(suite, undefined, globalBudget, false, {
					label,
					baselineDurationMs,
				})
				printSuiteSummary(label, result, genReport, false)
				await reportWriter.recordResult(index, {
					suite,
					passed: result.passed,
					failedFiles: result.failedFiles,
					output: result.output,
					durationMs: result.durationMs,
					terminated: result.terminated,
					terminateReason: result.terminateReason,
				})

				if (result.passed) {
					const record = timingsByManifest.get(suite.manifestId) ?? { items: {} }
					timingsByManifest.set(
						suite.manifestId,
						recordSuiteSuccessTiming(record, suite.name, result.durationMs),
					)
					timingsDirty.add(suite.manifestId)
				}

				if (trackFailures) {
					if (!manifestFailures.has(suite.manifestId))
						manifestFailures.set(suite.manifestId,
							(await readFailures(REPO_ROOT, suite.manifestId))?.items ?? [])
					manifestFailures.set(suite.manifestId, mergeSuiteResult(
						manifestFailures.get(suite.manifestId),
						suite.name,
						result.passed,
						result.failedFiles.length ? result.failedFiles : undefined,
					))
				}
			}
			finally {
				release()
			}
		}
	}

	await Promise.all(Array.from(
		{ length: Math.min(suiteConcurrency, pendingRuns.length) },
		() => suiteWorker(),
	))

	if (trackFailures) 
		for (const manifestId of manifestFailures.keys()) {
			const items = manifestFailures.get(manifestId) ?? []
			await writeFailures(REPO_ROOT, manifestId, items, currentHash)
			if (items.length)
				console.logI18n('fountConsole.test.failuresSaved', {
					path: relative(REPO_ROOT, failureFilePath(REPO_ROOT, manifestId)).replace(/\\/g, '/'),
					count: items.length,
				})
			else if (retryByManifest.has(manifestId))
				console.logI18n('fountConsole.test.failuresCleared', { manifestId })
		}
	

	for (const manifestId of timingsDirty)
		await writeTimings(REPO_ROOT, manifestId, timingsByManifest.get(manifestId) ?? { items: {} })

	const exitCode = exitCodeFromEntries(reportWriter.entries)
	const reportPath = await reportWriter.finalize(exitCode)
	console.logI18n('fountConsole.test.reportPathFinal', {
		path: reportPath.replace(/\\/g, '/'),
	})

	return exitCode
}
