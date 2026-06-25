import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import process from 'node:process'

import { execFile } from 'npm:@steve02081504/exec'

import { computeUncommittedHash, getUncommittedFiles, resolveChangedFiles } from '../core/changed.mjs'
import { computeConcurrency, SUITE_MEM } from '../core/concurrency.mjs'
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
import { outputHasNoise } from '../core/output_filter.mjs'
import { failureFilePath } from '../core/paths.mjs'
import { readFailuresOutFile, toRepoRelative } from '../core/protocol.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'

import { selectSuites, shouldTrackFailures } from './selection.mjs'

/**
 * runTests 入口选项。
 * @typedef {object} RunTestsOptions
 * @property {boolean} [runAll] 全量
 * @property {string} [since] diff 基准 commit
 * @property {string[]} [manifestSelectors] manifest 指名
 * @property {string[]} [suiteSelectors] suite id 或 name
 */

/**
 * 执行子进程命令并捕获 stdall。
 * @param {string[]} command 命令
 * @param {Record<string, string>} [extraEnv] 额外环境变量
 * @returns {Promise<{ code: number, output: string }>} 子进程退出码与输出
 */
async function runCommand(command, extraEnv = {}) {
	const [executable, ...args] = command
	const result = await execFile(executable, args, {
		cwd: REPO_ROOT,
		env: { ...process.env, ...extraEnv },
	})
	return { code: result.code ?? 1, output: result.stdall }
}

/**
 * 构造 suite 运行命令与环境变量。
 * @param {import('../core/manifest.mjs').SuiteDef} suite suite 定义
 * @param {string[] | undefined} onlyFiles 仅跑这些文件
 * @param {string} failuresOut 失败输出临时文件
 * @returns {{ command: string[], env: Record<string, string> }} 命令与环境
 */
function buildSuiteInvocation(suite, onlyFiles, failuresOut) {
	const env = {
		FOUNT_TEST: '1',
		FOUNT_TEST_KEEP_GOING: '1',
		FOUNT_TEST_FAILURES_OUT: failuresOut,
		FOUNT_TEST_SCOPE: suite.manifestId,
		// 始终重置 FOUNT_TEST_ONLY，防止外层 shell 环境变量泄漏进子进程影响测试过滤。
		FOUNT_TEST_ONLY: onlyFiles?.length ? onlyFiles.join('\n') : '',
	}
	return { command: [...suite.run], env }
}

/**
 * 运行单个 suite 并返回结果。
 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
 * @param {string[] | undefined} onlyFiles 失败重跑文件过滤
 * @returns {Promise<{ passed: boolean, failedFiles: string[], output: string }>} 运行结果
 */
async function runSuite(suite, onlyFiles) {
	const tempDir = await mkdtemp(join(tmpdir(), 'fount-test-'))
	const failuresOut = join(tempDir, 'failures.json')
	try {
		const { command, env } = buildSuiteInvocation(suite, onlyFiles, failuresOut)
		const { code, output } = await runCommand(command, env)
		return {
			passed: code === 0,
			failedFiles: (await readFailuresOutFile(failuresOut)).map(file => toRepoRelative(REPO_ROOT, file)),
			output,
		}
	}
	finally {
		await rm(tempDir, { recursive: true, force: true })
	}
}

/**
 * 主测试入口。
 * @param {RunTestsOptions} options 运行选项
 * @returns {Promise<number>} 进程退出码（0 为通过）
 */
export async function runTests(options = {}) {
	const allSuites = await loadAllSuites(REPO_ROOT)
	const knownIds = listManifestIds(allSuites)

	let manifestIds
	if (options.manifestSelectors?.length) {
		const resolved = resolveManifestSelectors(options.manifestSelectors, knownIds)
		if (resolved.unmatched.length) {
			console.error(`unknown manifest id: ${resolved.unmatched.join(', ')}`)
			console.error('available:', knownIds.join(', '))
			return 2
		}
		manifestIds = resolved.manifestIds
		if (manifestIds.length !== options.manifestSelectors.length
			|| options.manifestSelectors.some(selector => !knownIds.includes(selector)))
			console.log('manifest 匹配:', manifestIds.join(', '))
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

	console.log(`selected ${selected.length}/${allSuites.length} test suites`)

	if (!selected.length) {
		console.log('没有匹配的测试 suite。')
		return 0
	}

	const manifestFailures = new Map()
	let exitCode = 0

	const suiteConcurrency = computeConcurrency(SUITE_MEM, Number(process.env.FOUNT_TEST_SUITE_CONCURRENCY))
	/** @type {{ suite: import('../core/manifest.mjs').SuiteDef, result: Awaited<ReturnType<typeof runSuite>> }[]} */
	const suiteResults = new Array(selected.length)
	let cursor = 0

	/**
	 * 并发执行 suite，收集有序结果。
	 * @returns {Promise<void>}
	 */
	async function suiteWorker() {
		while (cursor < selected.length) {
			const index = cursor++
			const suite = selected[index]
			console.log(`\n>>> running ${suite.manifestId}/${suite.name}`)
			console.log('>>', suite.run.join(' '))
			const retryMap = retryByManifest.get(suite.manifestId)
			const onlyFiles = retryMap?.has(suite.name) ? retryMap.get(suite.name) : undefined
			const result = await runSuite(suite, onlyFiles)
			const label = `${suite.manifestId}/${suite.name}`
			const noisy = outputHasNoise(result.output)
			if (!result.passed || noisy) process.stdout.write(result.output)
			if (result.passed)
				console.log(`PASSED: ${label}${noisy ? ' (with noise)' : ''}`)
			else
				console.error(`FAILED: ${label}`)
			suiteResults[index] = { suite, result }
		}
	}

	await Promise.all(Array.from(
		{ length: Math.min(suiteConcurrency, selected.length) },
		() => suiteWorker(),
	))

	for (const { suite, result } of suiteResults) {
		if (!result.passed) exitCode = 1

		if (trackFailures || usingFailureRetry) {
			if (!manifestFailures.has(suite.manifestId)) {
				const seed = usingFailureRetry
					? (await readFailures(REPO_ROOT, suite.manifestId))?.items ?? []
					: []
				manifestFailures.set(suite.manifestId, seed)
			}
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
				console.log(`已保存失败列表: ${relative(REPO_ROOT, failureFilePath(REPO_ROOT, manifestId)).replace(/\\/g, '/')} (${items.length} suites)`)
			else if (retryByManifest.has(manifestId))
				console.log(`manifest ${manifestId} 全部通过，已清除失败列表。`)
		}
	}

	return exitCode
}
