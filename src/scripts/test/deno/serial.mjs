/**
 * 并发执行 Deno test（每文件独立子进程）。
 *
 * 目录参数会展开为各 *.test.mjs，每个文件在独立子进程中运行，
 * 避免集成 harness 在同一进程内堆积多个 server 实例导致 OOM。
 */
import 'fount/scripts/test/env.mjs'

import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

import { execFile } from 'npm:@steve02081504/exec'

import { console } from '../../i18n/bare.mjs'
import { computeConcurrency, readBudgetFromEnv, UNIT_MEM, concurrencyFromBudget } from '../core/concurrency.mjs'
import { outputHasNoise } from '../core/output_filter.mjs'
import {
	isIncludedInTestOnly,
	parseTestOnlyEnv,
	toRepoRelative,
	writeFailuresOutFile,
} from '../core/protocol.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'

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
 * 在子进程中执行 deno test 并捕获 stdall。
 * @param {string[]} command 可执行文件与参数
 * @returns {Promise<{ code: number, output: string, signal: string | null }>} 退出码与合并输出
 */
async function runCaptured(command) {
	const [executable, ...rest] = command
	const result = await execFile(executable, rest, { cwd: REPO_ROOT })
	const code = typeof result.code === 'number' ? result.code : (result.signal ? 1 : 0)
	return { code, output: result.stdall, signal: result.signal ?? null }
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

/**
 * 记录单文件 deno test 结果。
 * @param {string} file 测试文件绝对路径
 * @param {number} code 退出码
 * @param {string} output stdall
 * @param {string | null} [signal] 终止信号
 * @returns {void}
 */
function recordResult(file, code, output, signal = null) {
	const noisy = outputHasNoise(output)
	const rel = toRepoRelative(REPO_ROOT, file)
	if (code !== 0 || noisy) {
		process.stdout.write(output)
		if (code !== 0) {
			const hint = signal ? ` signal=${signal}` : ''
			process.stdout.write(`[serial] ${rel} exited ${code}${hint}\n`)
		}
	}
	else {
		// 静默通过也打一行，避免 --no-parallel 流式模式下 idle watchdog 误杀长套件
		process.stdout.write(`[serial] ok ${rel}\n`)
		silentPassed++
	}
	if (code !== 0) {
		failed.push(rel)
		if (!keepGoing) stopped = true
	}
}

// 预热：deno cache 填充 npm/node_modules
if (filteredFiles.length > 0) {
	const { code, output } = await runCaptured([
		'deno', 'cache', '--allow-scripts', '-c', './deno.json', ...filteredFiles,
	])
	if (code !== 0) {
		process.stdout.write(output)
		process.exit(code)
	}
}

/**
 * worker-pool 消费游标，并发跑单文件 deno test。
 * @returns {Promise<void>}
 */
async function worker() {
	while (!stopped) {
		const index = cursor++
		if (index >= filteredFiles.length) break
		const file = filteredFiles[index]
		const { code, output, signal } = await runCaptured(['deno', ...denoBase, file])
		recordResult(file, code, output, signal)
		if (stopped) return
	}
}

await Promise.all(Array.from(
	{ length: Math.min(concurrency, filteredFiles.length) },
	() => worker(),
))

if (silentPassed > 0)
	console.logI18n(silentPassed > 1
		? 'fountConsole.test.silentPassedMany'
		: 'fountConsole.test.silentPassedOne', silentPassed > 1 ? { count: silentPassed } : undefined)

if (failed.length) {
	await writeFailuresOutFile(process.env.FOUNT_TEST_FAILURES_OUT, failed)
	process.exit(1)
}

process.exit(0)
