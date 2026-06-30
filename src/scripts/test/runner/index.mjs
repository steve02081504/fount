import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import process from 'node:process'

import { execFile } from 'npm:@steve02081504/exec'

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

import { TestReportWriter } from './report.mjs'
import { SuiteRunGate } from './scheduler.mjs'
import { selectSuites, shouldTrackFailures } from './selection.mjs'

/**
 * runTests 入口选项。
 * @typedef {object} RunTestsOptions
 * @property {boolean} [runAll] 全量
 * @property {string} [since] diff 基准 commit
 * @property {string[]} [manifestSelectors] manifest 指名
 * @property {string[]} [suiteSelectors] suite id 或 name
 * @property {boolean} [genReport] 生成 data/test/report
 * @property {number} [jobs] 全局并发上限
 */

/**
 * 执行子进程命令并捕获 stdall。
 * @param {string[]} command 命令
 * @param {Record<string, string>} [extraEnv] 额外环境变量
 * @param {object} [options] 执行选项
 * @param {boolean} [options.stream=false] 是否实时转发 stdout/stderr
 * @returns {Promise<{ code: number, output: string }>} 子进程退出码与输出
 */
async function runCommand(command, extraEnv = {}, options = {}) {
	const { stream = false } = options
	const [executable, ...args] = command
	/** @type {import('npm:@steve02081504/exec').ExecOptions & object} */
	const execOptions = {
		cwd: REPO_ROOT,
		env: { ...process.env, ...extraEnv },
	}
	if (stream) 
		Object.assign(execOptions, {
			/**
			 * 转发子进程标准输出。
			 * @param {string | Uint8Array} data 标准输出片段
			 * @returns {void}
			 */
			on_stdout: data => process.stdout.write(data),
			/**
			 * 转发子进程标准错误。
			 * @param {string | Uint8Array} data 标准错误片段
			 * @returns {void}
			 */
			on_stderr: data => process.stderr.write(data),
		})
	
	const result = await execFile(executable, args, execOptions)
	return { code: result.code ?? 1, output: result.stdall }
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
		// 始终重置 FOUNT_TEST_ONLY，防止外层 shell 环境变量泄漏进子进程影响测试过滤。
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
 * @returns {Promise<{ passed: boolean, failedFiles: string[], output: string, durationMs: number }>} 运行结果
 */
async function runSuite(suite, onlyFiles, globalBudget, stream = false) {
	const tempDir = await mkdtemp(join(tmpdir(), 'fount-test-'))
	const failuresOut = join(tempDir, 'failures.json')
	const started = Date.now()
	try {
		const { command, env } = buildSuiteInvocation(suite, onlyFiles, failuresOut, globalBudget)
		const { code, output: rawOutput } = await runCommand(command, env, { stream })
		return {
			passed: code === 0,
			failedFiles: (await readFailuresOutFile(failuresOut)).map(file => toRepoRelative(REPO_ROOT, file)),
			output: filterTestOutput(rawOutput),
			durationMs: Date.now() - started,
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
 * 主测试入口。
 * @param {RunTestsOptions} options 运行选项
 * @returns {Promise<number>} 进程退出码（0 为通过）
 */
export async function runTests(options = {}) {
	const genReport = options.genReport === true
	const globalBudget = computeGlobalBudget(options.jobs)
	const runId = new Date().toISOString().replace(/[.:]/g, '-')

	const allSuites = await loadAllSuites(REPO_ROOT)
	const knownIds = listManifestIds(allSuites)

	let manifestIds
	if (options.manifestSelectors?.length) {
		const resolved = resolveManifestSelectors(options.manifestSelectors, knownIds)
		if (resolved.unmatched.length) {
			console.errorI18n('fountConsole.test.unknownManifestId', {
				ids: resolved.unmatched.join(', '),
			})
			console.errorI18n('fountConsole.test.available', { ids: knownIds.join(', ') })
			return 2
		}
		manifestIds = resolved.manifestIds
		if (manifestIds.length !== options.manifestSelectors.length
			|| options.manifestSelectors.some(selector => !knownIds.includes(selector)))
			console.logI18n('fountConsole.test.manifestMatched', { ids: manifestIds.join(', ') })
	}

	const trackFailures = shouldTrackFailures(manifestIds)

	const changed = await resolveChangedFiles({
		repoRoot: REPO_ROOT,
		runAll: options.runAll,
		since: options.since,
	})

	const [currentHash, uncommittedFiles] = await Promise.all([
		computeUncommittedHash(REPO_ROOT),
		getUncommittedFiles(REPO_ROOT),
	])

	let filtered = allSuites
	if (manifestIds?.length || options.suiteSelectors?.length)
		filtered = filterSuites(filtered, {
			manifestIds,
			suiteSelectors: options.suiteSelectors,
		})

	const selection = await selectSuites({
		repoRoot: REPO_ROOT,
		allSuites,
		filtered,
		changed,
		runAll: options.runAll === true,
		manifestIds,
		suiteSelectors: options.suiteSelectors,
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
		return 0
	}

	const streamLive = !genReport && selected.length === 1

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
		const commandParts = ['fount test']
		if (options.runAll) commandParts.push('--all')
		commandParts.push('--gen-report')
		if (options.jobs >= 1) commandParts.push('-j', String(options.jobs))
		if (options.since) commandParts.push('--since', options.since)
		if (options.manifestSelectors?.length)
			commandParts.push(options.manifestSelectors.join(','))
		if (options.suiteSelectors?.length)
			commandParts.push(options.suiteSelectors.join(','))

		reportWriter = new TestReportWriter({
			repoRoot: REPO_ROOT,
			suites: selected,
			runId,
			command: commandParts.join(' '),
		})
		const reportPath = await reportWriter.init()
		console.logI18n('fountConsole.test.reportPath', {
			path: reportPath.replace(/\\/g, '/'),
		})
	}

	/**
	 * 并发执行 suite，收集有序结果。
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
				const result = await runSuite(suite, onlyFiles, globalBudget, streamLive)
				const label = `${suite.manifestId}/${suite.name}`
				printSuiteSummary(label, result, genReport, streamLive)
				suiteResults[index] = { suite, result }
				if (reportWriter) 
					await reportWriter.recordResult(index, {
						suite,
						passed: result.passed,
						failedFiles: result.failedFiles,
						output: result.output,
						durationMs: result.durationMs,
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

	if (reportWriter) {
		const reportPath = await reportWriter.finalize(exitCode)
		console.logI18n('fountConsole.test.reportPathFinal', {
			path: reportPath.replace(/\\/g, '/'),
		})
	}

	return exitCode
}
