/**
 * 测试启动/收尾速度基准：单个 trivial suite 的完整周期开销拆分。
 *
 * 复用真实 building blocks（buildSuiteInvocation / runCommand / protocol 读写），
 * 无内核依赖（module-check 租约跳过 → 纯子进程 spawn 开销）。
 *
 * 用法（仓库根）：
 *   deno run --allow-scripts --allow-all -c ./deno.json ./src/scripts/test/tools/bench/test_cycle.mjs [迭代次数=5]
 */
/* global Deno */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { readFailuresOutFile, readTimingsOutFile } from '../../core/protocol.mjs'
import { REPO_ROOT } from '../../core/repo_root.mjs'
import { runCommand } from '../../runner/run_command.mjs'
import { buildSuiteInvocation } from '../../runner/suite_run.mjs'

import { fmt, renderTable, row } from './common.mjs'

const ITERATIONS = Math.max(1, Number(process.argv[2]) || 5)

/** 一次 bench 用的 trivial 测试文件内容。 */
const TRIVIAL_TEST = 'Deno.test(\'trivial\', () => {})\n'

/**
 * 跑一次细粒度 suite 周期。
 * @param {import('../../core/manifest.mjs').SuiteDef} suite 合成 suite
 * @returns {Promise<Record<string, number> & { exitCode: number }>} 各阶段耗时
 */
async function cycleOnce(suite) {
	const cycleStart = performance.now()
	const tempDir = await mkdtemp(join(tmpdir(), 'fount-bench-'))
	const mkMs = performance.now() - cycleStart

	const failuresOut = join(tempDir, 'failures.json')
	const timingsOut = join(tempDir, 'timings.json')
	const buildStart = performance.now()
	const { command, env } = buildSuiteInvocation(suite, {}, failuresOut, timingsOut, '', undefined)
	const buildMs = performance.now() - buildStart

	let result
	let childMs = 0
	let readMs = 0
	let rmMs = 0
	try {
		const childStart = performance.now()
		result = await runCommand(command, env, {
			stream: false,
			cwd: REPO_ROOT,
			label: 'bench:trivial',
		})
		childMs = performance.now() - childStart

		const readStart = performance.now()
		await readTimingsOutFile(timingsOut)
		await readFailuresOutFile(failuresOut)
		readMs = performance.now() - readStart
	}
	finally {
		const rmStart = performance.now()
		await rm(tempDir, { recursive: true, force: true })
		rmMs = performance.now() - rmStart
	}

	return {
		total: performance.now() - cycleStart,
		mkdtemp: mkMs,
		build: buildMs,
		child: childMs,
		read: readMs,
		rm: rmMs,
		exitCode: result.code,
	}
}

/**
 * 内核链接探针加载基准辅助——生成 bench 用临时 trivial 测试文件。
 * @returns {Promise<{ dir: string, file: string }>} 临时目录与测试文件绝对路径
 */
async function makeTrivialFile() {
	const dir = await mkdtemp(join(tmpdir(), 'fount-bench-fixture-'))
	const file = join(dir, 'trivial.test.mjs')
	await writeFile(file, TRIVIAL_TEST, 'utf8')
	return { dir, file }
}

const fixture = await makeTrivialFile()
const suite = {
	manifestId: 'bench',
	name: 'trivial',
	id: 'trivial',
	run: [Deno.execPath(), 'test', '--no-check', '--allow-scripts', '--allow-all', '-c', './deno.json', fixture.file],
	triggers: [],
	manifestPath: 'bench/manifest.json',
	heavy: false,
}

console.log(`test cycle bench — ${ITERATIONS} 次（child 为 deno test --no-check 空用例）`)
console.log('')

/** @type {Record<string, number>[]} */
const runs = []
let failed = 0
try {
	for (let iterationIndex = 0; iterationIndex < ITERATIONS; iterationIndex++) {
		const result = await cycleOnce(suite)
		runs.push(result)
		if (result.exitCode !== 0) failed++
		console.log(`  #${iterationIndex + 1}: total ${fmt(result.total)}ms  child ${fmt(result.child)}ms  exit ${result.exitCode}`)
	}
}
finally {
	await rm(fixture.dir, { recursive: true, force: true })
}

if (failed) {
	console.error(`\n${failed}/${ITERATIONS} 次 child 退出非零 — 请检查 deno 环境`)
	process.exit(1)
}

/**
 * 提取某相位名的耗时样本数组。
 * @param {string} key 相位键
 * @returns {number[]} 样本
 */
const pick = key => runs.map(r => r[key])
console.log(renderTable('测试启动/收尾（各阶段 min / 中位 / max）', [
	{ name: 'total', samples: pick('total') },
	{ name: 'mkdtemp', samples: pick('mkdtemp') },
	{ name: 'buildInvocation', samples: pick('build') },
	{ name: 'child（spawn→exit）', samples: pick('child') },
	{ name: 'readOutputs', samples: pick('read') },
	{ name: 'rmTempDir', samples: pick('rm') },
]))

console.log('')
console.log('总计：', row(pick('total')), 'ms（min / 中位 / max）')
console.log('')
console.log('注：有内核时每个 suite 还会额外做一次 /module-check/acquire→ready HTTP 往返（见 kernel_link 的 preload 相位）；')
console.log('    本工具跑的是无内核的纯子进程 spawn + 收尾开销。')
