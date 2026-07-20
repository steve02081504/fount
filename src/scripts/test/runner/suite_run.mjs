import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import process from 'node:process'

import { applyBudgetToEnv } from '../core/concurrency.mjs'
import { filterTestOutput } from '../core/output_filter.mjs'
import { readFailuresOutFile, readTimingsOutFile, toRepoRelative } from '../core/protocol.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import { suiteUsesSerialRunner } from '../core/resources.mjs'

import { runCommand } from './run_command.mjs'

/**
 * 为 deno run 子进程注入测试堆上限（与 fount test 入口一致）。
 * @param {string[]} command manifest run 命令
 * @returns {string[]} 可能插入 --v8-flags 的命令
 */
export function applyTestHeapCapToDenoRun(command) {
	const mb = process.env.FOUNT_TEST_ORCHESTRATOR_HEAP_MB
	if (!mb || command[0] !== 'deno' || command[1] !== 'run') return command
	if (command.some(arg => arg.startsWith('--v8-flags=--max-old-space-size='))) return command
	const flag = `--v8-flags=--max-old-space-size=${mb}`
	const out = [...command]
	const configIdx = out.indexOf('-c')
	if (configIdx >= 0 && configIdx + 1 < out.length) out.splice(configIdx + 2, 0, flag)
	else out.splice(2, 0, flag)
	return out
}

/**
 * @typedef {object} SuiteInvocationOptions
 * @property {string[]} [firstFiles] FOUNT_TEST_FIRST：失败优先路径
 * @property {string[]} [subtests] FOUNT_TEST_SUBTESTS：子测试名
 * @property {string[]} [onlyFiles] FOUNT_TEST_ONLY：范围过滤（少用）
 */

/**
 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
 * @param {SuiteInvocationOptions} options 调用选项
 * @param {string} failuresOut 失败输出临时文件
 * @param {string} timingsOut 耗时输出临时文件
 * @param {import('../core/concurrency.mjs').GlobalBudget | undefined} globalBudget 全局预算
 * @returns {{ command: string[], env: Record<string, string> }} 命令与环境
 */
export function buildSuiteInvocation(suite, options, failuresOut, timingsOut, globalBudget) {
	const { firstFiles, subtests, onlyFiles } = options ?? {}
	const env = {
		FOUNT_TEST: '1',
		FOUNT_TEST_KEEP_GOING: '1',
		FOUNT_TEST_FAILURES_OUT: failuresOut,
		FOUNT_TEST_TIMINGS_OUT: timingsOut,
		FOUNT_TEST_SCOPE: suite.manifestId,
		FOUNT_TEST_ONLY: onlyFiles?.length ? onlyFiles.join('\n') : '',
		FOUNT_TEST_FIRST: firstFiles?.length ? firstFiles.join('\n') : '',
		FOUNT_TEST_SUBTESTS: subtests?.length ? subtests.join('\n') : '',
		RUST_BACKTRACE: 'full',
	}
	if (suiteUsesSerialRunner(suite) && globalBudget)
		applyBudgetToEnv(env, globalBudget)
	return { command: applyTestHeapCapToDenoRun([...suite.run]), env }
}

/**
 * 将 per-spec 耗时映射为子测试名 → 毫秒。
 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
 * @param {Record<string, number>} timings 仓库相对路径 → 毫秒
 * @param {string[] | undefined} ranSubtests 本次跑过的子测试名
 * @returns {Record<string, number>} 子测试名 → 毫秒
 */
export function mapTimingsToSubtests(suite, timings, ranSubtests) {
	if (!suite.subtests?.length || !timings) return {}
	const names = ranSubtests?.length
		? ranSubtests
		: suite.subtests.map(st => st.name)
	const byName = new Map(suite.subtests.map(st => [st.name, st]))
	/** @type {Record<string, number>} */
	const out = {}
	for (const name of names) {
		const subtest = byName.get(name)
		if (!subtest) continue
		const spec = subtest.spec.replace(/\\/g, '/')
		const stem = basename(spec)
		let matched = 0
		for (const [path, ms] of Object.entries(timings)) {
			const rel = path.replace(/\\/g, '/')
			if (rel === spec || rel.endsWith(`/${spec}`) || basename(rel) === stem)
				matched += ms
		}
		if (matched > 0) out[name] = matched
	}
	return out
}

/**
 * @typedef {object} SuiteRunResult
 * @property {boolean} passed
 * @property {number} exitCode
 * @property {string[]} failedFiles
 * @property {string} output
 * @property {number} durationMs
 * @property {Record<string, number>} [subtestDurations] 子测试名 → 毫秒
 * @property {number} [peakMemMb]
 * @property {number} [avgCpuPct]
 * @property {boolean} [terminated]
 * @property {string} [terminateReason]
 */

/**
 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
 * @param {SuiteInvocationOptions | undefined} options 调用选项
 * @param {import('../core/concurrency.mjs').GlobalBudget | undefined} globalBudget 全局预算
 * @param {boolean} [stream] 是否实时转发 stdout/stderr
 * @param {object} [watchdog] watchdog 选项
 * @param {string} [watchdog.label] suite 标签
 * @param {number} [watchdog.baselineDurationMs] 基线耗时
 * @param {AbortSignal} [watchdog.signal] 外部取消
 * @returns {Promise<SuiteRunResult>} 运行结果
 */
export async function runSuite(suite, options, globalBudget, stream = false, watchdog = {}) {
	const tempDir = await mkdtemp(join(tmpdir(), 'fount-test-'))
	const failuresOut = join(tempDir, 'failures.json')
	const timingsOut = join(tempDir, 'timings.json')
	const started = Date.now()
	try {
		const { command, env } = buildSuiteInvocation(suite, options ?? {}, failuresOut, timingsOut, globalBudget)
		const { code, output, terminated, terminateReason, peakMemMb, avgCpuPct } = await runCommand(command, env, {
			stream,
			cwd: REPO_ROOT,
			label: watchdog.label,
			baselineDurationMs: watchdog.baselineDurationMs,
			signal: watchdog.signal,
		})
		const timings = await readTimingsOutFile(timingsOut)
		return {
			passed: code === 0 && !terminated,
			exitCode: code,
			failedFiles: (await readFailuresOutFile(failuresOut)).map(file => toRepoRelative(REPO_ROOT, file)),
			output: filterTestOutput(output),
			durationMs: Date.now() - started,
			subtestDurations: mapTimingsToSubtests(suite, timings, options?.subtests),
			peakMemMb,
			avgCpuPct,
			terminated,
			terminateReason,
		}
	}
	finally {
		await rm(tempDir, { recursive: true, force: true })
	}
}
