import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { applyBudgetToEnv } from '../core/concurrency.mjs'
import { filterTestOutput } from '../core/output_filter.mjs'
import { readFailuresOutFile, toRepoRelative } from '../core/protocol.mjs'
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
 * @param {import('../core/concurrency.mjs').GlobalBudget | undefined} globalBudget 全局预算
 * @returns {{ command: string[], env: Record<string, string> }} 命令与环境
 */
export function buildSuiteInvocation(suite, options, failuresOut, globalBudget) {
	const { firstFiles, subtests, onlyFiles } = options ?? {}
	const env = {
		FOUNT_TEST: '1',
		FOUNT_TEST_KEEP_GOING: '1',
		FOUNT_TEST_FAILURES_OUT: failuresOut,
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
 * @typedef {object} SuiteRunResult
 * @property {boolean} passed
 * @property {number} exitCode
 * @property {string[]} failedFiles
 * @property {string} output
 * @property {number} durationMs
 * @property {number} [peakMemMb]
 * @property {number} [avgCpuPct]
 * @property {boolean} [terminated]
 * @property {string} [terminateReason]
 */

/**
 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
 * @param {SuiteInvocationOptions | string[] | undefined} optionsOrFirst 调用选项或旧版 firstFiles
 * @param {import('../core/concurrency.mjs').GlobalBudget | undefined} globalBudget 全局预算
 * @param {boolean} [stream] 是否实时转发 stdout/stderr
 * @param {object} [watchdog] watchdog 选项
 * @returns {Promise<SuiteRunResult>} 运行结果
 */
export async function runSuite(suite, optionsOrFirst, globalBudget, stream = false, watchdog = {}) {
	const options = Array.isArray(optionsOrFirst) || optionsOrFirst == null
		? { firstFiles: optionsOrFirst }
		: optionsOrFirst
	const tempDir = await mkdtemp(join(tmpdir(), 'fount-test-'))
	const failuresOut = join(tempDir, 'failures.json')
	const started = Date.now()
	try {
		const { command, env } = buildSuiteInvocation(suite, options, failuresOut, globalBudget)
		const { code, output, terminated, terminateReason, peakMemMb, avgCpuPct } = await runCommand(command, env, {
			stream,
			cwd: REPO_ROOT,
			label: watchdog.label,
			baselineDurationMs: watchdog.baselineDurationMs,
		})
		return {
			passed: code === 0 && !terminated,
			exitCode: code,
			failedFiles: (await readFailuresOutFile(failuresOut)).map(file => toRepoRelative(REPO_ROOT, file)),
			output: filterTestOutput(output),
			durationMs: Date.now() - started,
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
