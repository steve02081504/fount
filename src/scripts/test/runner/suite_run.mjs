import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import process from 'node:process'

import { console } from '../../i18n/bare.mjs'
import { applyBudgetToEnv } from '../core/concurrency.mjs'
import { filterTestOutput } from '../core/output_filter.mjs'
import {
	readFailuresOutFile,
	readTimingsOutFile,
	toRepoRelative,
	writeTestTriggeredFiles,
} from '../core/protocol.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import { suiteUsesSerialRunner } from '../core/resources.mjs'
import { moduleCheckTicketEnv, withDenoModuleCheckPreload } from '../hub/clients/module_check.mjs'

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
 * suite 调用环境变量与命令。
 * @typedef {object} SuiteInvocationOptions
 * @property {string[]} [firstFiles] FOUNT_TEST_FIRST：失败优先路径
 * @property {string[]} [subtests] FOUNT_TEST_SUBTESTS：子测试名
 * @property {string[]} [onlyFiles] FOUNT_TEST_ONLY：范围过滤（少用）
 * @property {string[]} [triggeredFiles] 本波次命中 trigger 的变更路径（写入临时文件后经 env 传路径）
 * @property {string} [moduleCheckTicket] 模组检查租约
 */

/**
 * 组装 suite 子进程命令与环境变量。
 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
 * @param {SuiteInvocationOptions} options 调用选项
 * @param {string} failuresOut 失败输出临时文件
 * @param {string} timingsOut 耗时输出临时文件
 * @param {string} triggeredFilesPath trigger 列表临时文件；无列表时传空串
 * @param {import('../core/concurrency.mjs').GlobalBudget | undefined} globalBudget 全局预算
 * @returns {{ command: string[], env: Record<string, string> }} 命令与环境
 */
export function buildSuiteInvocation(suite, options, failuresOut, timingsOut, triggeredFilesPath, globalBudget) {
	const { firstFiles, subtests, onlyFiles, moduleCheckTicket } = options ?? {}
	const env = {
		FOUNT_TEST: '1',
		FOUNT_TEST_KEEP_GOING: '1',
		FOUNT_TEST_FAILURES_OUT: failuresOut,
		FOUNT_TEST_TIMINGS_OUT: timingsOut,
		FOUNT_TEST_SCOPE: suite.manifestId,
		FOUNT_TEST_ONLY: onlyFiles?.length ? onlyFiles.join('\n') : '',
		FOUNT_TEST_FIRST: firstFiles?.length ? firstFiles.join('\n') : '',
		FOUNT_TEST_SUBTESTS: subtests?.length ? subtests.join('\n') : '',
		FOUNT_TEST_TRIGGERED_FILES: triggeredFilesPath || '',
		RUST_BACKTRACE: 'full',
		...moduleCheckTicketEnv(moduleCheckTicket),
	}
	if (suiteUsesSerialRunner(suite) && globalBudget)
		applyBudgetToEnv(env, globalBudget)
	return {
		command: withDenoModuleCheckPreload(applyTestHeapCapToDenoRun([...suite.run]), moduleCheckTicket),
		env,
	}
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
 * suite 单次运行结果。
 * @typedef {object} SuiteRunResult
 * @property {boolean} passed 是否通过
 * @property {number} exitCode 子进程退出码
 * @property {string[]} failedFiles 失败文件（仓库相对路径）
 * @property {string} output 过滤后的输出尾部
 * @property {number} durationMs 墙钟耗时
 * @property {Record<string, number>} [subtestDurations] 子测试名 → 毫秒
 * @property {number} [peakMemMb] 峰值内存（MB）
 * @property {number} [avgCpuPct] 平均 CPU（%）
 * @property {boolean} [terminated] 是否被 watchdog 终止
 * @property {string} [terminateReason] 终止原因
 */

/**
 * 单次执行 suite（不含休眠重试）。
 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
 * @param {SuiteInvocationOptions | undefined} options 调用选项
 * @param {import('../core/concurrency.mjs').GlobalBudget | undefined} globalBudget 全局预算
 * @param {boolean} stream 是否实时转发 stdout/stderr
 * @param {object} watchdog watchdog 选项
 * @returns {Promise<SuiteRunResult & { sleepInterrupted?: boolean }>} 运行结果
 */
async function runSuiteOnce(suite, options, globalBudget, stream, watchdog) {
	const tempDir = await mkdtemp(join(tmpdir(), 'fount-test-'))
	const failuresOut = join(tempDir, 'failures.json')
	const timingsOut = join(tempDir, 'timings.json')
	const triggeredFilesPath = join(tempDir, 'triggered.txt')
	const started = Date.now()
	try {
		const triggered = options?.triggeredFiles
		const triggeredEnvPath = triggered?.length ? triggeredFilesPath : ''
		if (triggeredEnvPath)
			await writeTestTriggeredFiles(triggeredFilesPath, triggered)
		const { command, env } = buildSuiteInvocation(
			suite, options ?? {}, failuresOut, timingsOut, triggeredEnvPath, globalBudget,
		)
		const {
			code, output, terminated, sleepInterrupted, terminateReason, peakMemMb, avgCpuPct,
		} = await runCommand(command, env, {
			stream,
			cwd: REPO_ROOT,
			label: watchdog.label,
			baselineDurationMs: watchdog.baselineDurationMs,
			signal: watchdog.signal,
			onStdout: watchdog.onStdout,
			onStderr: watchdog.onStderr,
		})
		const timings = await readTimingsOutFile(timingsOut)
		return {
			passed: code === 0 && !terminated && !sleepInterrupted,
			exitCode: code,
			failedFiles: (await readFailuresOutFile(failuresOut)).map(file => toRepoRelative(REPO_ROOT, file)),
			output: filterTestOutput(output),
			durationMs: Date.now() - started,
			subtestDurations: mapTimingsToSubtests(suite, timings, options?.subtests),
			peakMemMb,
			avgCpuPct,
			terminated,
			sleepInterrupted,
			terminateReason,
		}
	}
	finally {
		await rm(tempDir, { recursive: true, force: true })
	}
}

/**
 * 系统休眠中断后最多重跑次数（含首次）。超出则 terminated，避免无限循环。
 */
export const MAX_SLEEP_INTERRUPT_ATTEMPTS = 5

/**
 * 运行 suite：含 sleep 中断重跑（有界）。
 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
 * @param {SuiteInvocationOptions | undefined} options 调用选项
 * @param {import('../core/concurrency.mjs').GlobalBudget | undefined} globalBudget 全局预算
 * @param {boolean} [stream] 是否实时转发 stdout/stderr
 * @param {object} [watchdog] watchdog 选项
 * @param {string} [watchdog.label] suite 标签
 * @param {number} [watchdog.baselineDurationMs] 基线耗时
 * @param {AbortSignal} [watchdog.signal] 外部取消
 * @param {(chunk: string) => void} [watchdog.onStdout] stdout 回调
 * @param {(chunk: string) => void} [watchdog.onStderr] stderr 回调
 * @returns {Promise<SuiteRunResult>} 运行结果
 */
export async function runSuite(suite, options, globalBudget, stream = false, watchdog = {}) {
	const label = watchdog.label || `${suite.manifestId}:${suite.name}`
	let attempt = 0
	for (; ;) {
		attempt++
		if (watchdog.signal?.aborted)
			return {
				passed: false,
				exitCode: 1,
				failedFiles: [],
				output: '',
				durationMs: 0,
				terminated: true,
				terminateReason: String(watchdog.signal.reason || ''),
			}

		if (attempt > MAX_SLEEP_INTERRUPT_ATTEMPTS)
			return {
				passed: false,
				exitCode: 1,
				failedFiles: [],
				output: '',
				durationMs: 0,
				terminated: true,
				terminateReason: `sleep_retry_exhausted:${MAX_SLEEP_INTERRUPT_ATTEMPTS}`,
			}

		const result = await runSuiteOnce(suite, options, globalBudget, stream, watchdog)
		if (!result.sleepInterrupted) {
			const { sleepInterrupted: _, ...rest } = result
			return rest
		}
		if (attempt < MAX_SLEEP_INTERRUPT_ATTEMPTS)
			console.warnI18n('fountConsole.test.sleepRetry', {
				label,
				attempt: attempt + 1,
			})
	}
}
