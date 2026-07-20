/**
 * 并发执行 Deno test（每文件独立子进程）。
 *
 * 目录参数会展开为各 *.test.mjs，每个文件在独立子进程中运行，
 * 避免集成 harness 在同一进程内堆积多个 server 实例导致 OOM。
 *
 * FOUNT_TEST_FIRST：失败项优先；失败组有复现则跑完失败组即退，不跑其余。
 */
import 'fount/scripts/test/env.mjs'

import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { execFile } from 'npm:@steve02081504/exec'

import { console } from '../../i18n/bare.mjs'
import { computeConcurrency, readBudgetFromEnv, UNIT_MEM, concurrencyFromBudget } from '../core/concurrency.mjs'
import { isDenoTeardownCrashAfterGreenTests } from '../core/deno_panic.mjs'
import { outputHasNoise } from '../core/output_filter.mjs'
import {
	isIncludedInTestOnly,
	orderFailedFirst,
	parseTestFirstEnv,
	parseTestOnlyEnv,
	toRepoRelative,
	writeFailuresOutFile,
} from '../core/protocol.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import { childEnv } from '../env.mjs'

const args = process.argv.slice(2)

/**
 * 递归收集目录下的 *.test.mjs。
 * @param {string} directory 起始目录
 * @returns {string[]} 排序后的测试文件绝对路径
 */
function collectTestFiles(directory) {
	const files = []
	for (const name of readdirSync(directory)) {
		const path = join(directory, name)
		if (statSync(path).isDirectory()) {
			if (name === 'live' || name === 'frontend') continue
			files.push(...collectTestFiles(path))
		}
		else if (name.endsWith('.test.mjs'))
			files.push(path)
	}
	return files.sort()
}

/**
 * 在子进程中执行 deno test 并捕获 stdall；实时转发 stdall 以免 orchestrator idle watchdog 误杀。
 * @param {string[]} command 可执行文件与参数
 * @param {Record<string, string>} [extraEnv] 额外注入子进程的环境变量
 * @returns {Promise<{ code: number, output: string, signal: string | null }>} 退出码与合并输出
 */
async function runCaptured(command, extraEnv = {}) {
	const [executable, ...rest] = command
	let output = ''
	const result = await execFile(executable, rest, {
		cwd: REPO_ROOT,
		env: childEnv(extraEnv),
		no_output_record: true,
		/**
		 * @param {string | Uint8Array} data stdout 片段
		 * @returns {void}
		 */
		on_stdout: data => {
			process.stdout.write(data)
			output += typeof data === 'string' ? data : new TextDecoder().decode(data)
		},
		/**
		 * @param {string | Uint8Array} data stderr 片段
		 * @returns {void}
		 */
		on_stderr: data => {
			process.stderr.write(data)
			output += typeof data === 'string' ? data : new TextDecoder().decode(data)
		},
	})
	const code = typeof result.code === 'number' ? result.code : result.signal ? 1 : 0
	return { code, output, signal: result.signal ?? null }
}

if (!args.length) {
	console.errorI18n('fountConsole.test.serialUsage')
	process.exit(2)
}

let testFiles = []
for (const arg of args) {
	if (arg.startsWith('--')) continue
	const path = resolve(REPO_ROOT, arg)
	if (statSync(path).isDirectory())
		testFiles.push(...collectTestFiles(path))
	else
		testFiles.push(path)
}

const ignore = args.find(arg => arg.startsWith('--ignore='))?.slice('--ignore='.length)
const ignorePrefix = ignore ? resolve(REPO_ROOT, ignore) : null
const filterList = parseTestOnlyEnv()
const firstList = parseTestFirstEnv()
const keepGoing = process.env.FOUNT_TEST_KEEP_GOING === '1'

if (filterList.length)
	testFiles = testFiles.filter(file => isIncludedInTestOnly(REPO_ROOT, toRepoRelative(REPO_ROOT, file), filterList))

const denoBase = ['test', '--no-check', '--allow-scripts', '--allow-all', '-c', './deno.json']
const budget = readBudgetFromEnv()
const concurrency = budget
	? concurrencyFromBudget(UNIT_MEM, budget.cores, budget.memBytes)
	: computeConcurrency(UNIT_MEM, Number(process.env.FOUNT_TEST_UNIT_CONCURRENCY))
const failed = []
let silentPassed = 0
let stopped = false
let cursor = 0
const filteredFiles = testFiles.filter(file => !(ignorePrefix && file.startsWith(ignorePrefix)))
const { first: firstFiles, rest: restFiles } = orderFailedFirst(
	filteredFiles,
	firstList,
	file => toRepoRelative(REPO_ROOT, file),
)

/**
 * 记录单文件 deno test 结果。
 * @param {string} file 测试文件绝对路径
 * @param {number} code 退出码
 * @param {string} output stdall
 * @param {string | null} [signal] 终止信号
 * @returns {boolean} 是否记为失败
 */
function recordResult(file, code, output, signal = null) {
	const teardownCrash = isDenoTeardownCrashAfterGreenTests(code, output, signal)
	const noisy = outputHasNoise(output)
	const rel = toRepoRelative(REPO_ROOT, file)
	if (code !== 0 && !teardownCrash) {
		const hint = signal ? ` signal=${signal}` : ''
		process.stdout.write(`[serial] ${rel} exited ${code}${hint}\n`)
	}
	else if (code !== 0 && teardownCrash) {
		process.stdout.write(`[serial] ok ${rel} (deno teardown crash after pass)\n`)
		silentPassed++
	}
	else if (noisy) {
		// 已通过但含噪声：输出已在 runCaptured 中实时转发
	}
	else {
		process.stdout.write(`[serial] ok ${rel}\n`)
		silentPassed++
	}
	if (code !== 0 && !teardownCrash) {
		failed.push(rel)
		return true
	}
	return false
}

/**
 * worker-pool 消费游标，并发跑文件列表。
 * @param {string[]} files 待跑文件
 * @param {{ stopOnFailure: boolean }} options 失败是否停止调度
 * @returns {Promise<void>}
 */
async function runPool(files, { stopOnFailure }) {
	cursor = 0
	stopped = false
	/**
	 * @returns {Promise<void>}
	 */
	async function worker() {
		while (!stopped) {
			const index = cursor++
			if (index >= files.length) break
			const file = files[index]
			// DENO_JOBS=1：单文件内 Deno.test 默认并行会叠多个 launchNode，与 hold→release→spawn TOCTOU 互抢端口。
			const { code, output, signal } = await runCaptured(['deno', ...denoBase, file], {
				DENO_JOBS: '1',
			})
			const isFail = recordResult(file, code, output, signal)
			if (isFail && stopOnFailure) {
				stopped = true
				return
			}
			if (isFail && !keepGoing) {
				stopped = true
				return
			}
		}
	}
	await Promise.all(Array.from(
		{ length: Math.min(concurrency, files.length || 1) },
		() => worker(),
	))
}

// 失败组优先：整组跑完后若有失败则直接退出，不跑 rest
if (firstFiles.length) {
	await runPool(firstFiles, { stopOnFailure: false })
	if (failed.length) {
		await writeFailuresOutFile(process.env.FOUNT_TEST_FAILURES_OUT, failed)
		process.exit(1)
	}
}

if (restFiles.length)
	await runPool(restFiles, { stopOnFailure: !keepGoing })

if (silentPassed > 0)
	console.logI18n(silentPassed > 1
		? 'fountConsole.test.silentPassedMany'
		: 'fountConsole.test.silentPassedOne', silentPassed > 1 ? { count: silentPassed } : undefined)

if (failed.length) {
	await writeFailuresOutFile(process.env.FOUNT_TEST_FAILURES_OUT, failed)
	process.exit(1)
}

process.exit(0)
