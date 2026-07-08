import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
 * @param {string[] | undefined} onlyFiles 仅跑这些文件
 * @param {string} failuresOut 失败输出临时文件
 * @param {import('../core/concurrency.mjs').GlobalBudget | undefined} globalBudget 全局预算
 * @returns {{ command: string[], env: Record<string, string> }} 命令与环境
 */
export function buildSuiteInvocation(suite, onlyFiles, failuresOut, globalBudget) {
	const env = {
		FOUNT_TEST: '1',
		FOUNT_TEST_KEEP_GOING: '1',
		FOUNT_TEST_FAILURES_OUT: failuresOut,
		FOUNT_TEST_SCOPE: suite.manifestId,
		FOUNT_TEST_ONLY: onlyFiles?.length ? onlyFiles.join('\n') : '',
	}
	if (suiteUsesSerialRunner(suite) && globalBudget)
		applyBudgetToEnv(env, globalBudget)
	return { command: applyTestHeapCapToDenoRun([...suite.run]), env }
}

/**
 * @param {import('../core/manifest.mjs').SuiteDef} suite suite
 * @param {string[] | undefined} onlyFiles 失败重跑文件过滤
 * @param {import('../core/concurrency.mjs').GlobalBudget | undefined} globalBudget 全局预算
 * @param {boolean} [stream] 是否实时转发 stdout/stderr
 * @param {object} [watchdog] watchdog 选项
 * @returns {Promise<{ passed: boolean, exitCode: number, failedFiles: string[], output: string, durationMs: number, peakMemMb?: number, avgCpuPct?: number, terminated?: boolean, terminateReason?: string }>} 运行结果
 */
export async function runSuite(suite, onlyFiles, globalBudget, stream = false, watchdog = {}) {
	const tempDir = await mkdtemp(join(tmpdir(), 'fount-test-'))
	const failuresOut = join(tempDir, 'failures.json')
	const started = Date.now()
	try {
		const { command, env } = buildSuiteInvocation(suite, onlyFiles, failuresOut, globalBudget)
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
