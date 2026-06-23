/**
 * 串行执行 Deno test。
 *
 * 目录参数会展开为各 *.test.mjs，每个文件在独立子进程中运行，
 * 避免集成 harness 在同一进程内堆积多个 server 实例导致 OOM。
 */
import { spawn } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

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
 * 在子进程中执行命令并返回退出码。
 * @param {string[]} command 可执行文件与参数
 * @returns {Promise<number>} 退出码
 */
function run(command) {
	const [executable, ...rest] = command
	return new Promise(resolve => {
		const child = spawn(executable, rest, { cwd: REPO_ROOT, stdio: 'inherit' })
		child.on('close', code => resolve(code ?? 1))
	})
}

if (!args.length) {
	console.error('usage: serial.mjs <deno-test-path> [...]')
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

const denoBase = ['test', '--no-check', '--allow-all', '-c', './deno.json']
const failed = []
for (const file of testFiles) {
	if (ignorePrefix && file.startsWith(ignorePrefix)) continue
	const code = await run(['deno', ...denoBase, file])
	if (code !== 0) {
		failed.push(toRepoRelative(REPO_ROOT, file))
		if (!keepGoing) {
			await writeFailuresOutFile(process.env.FOUNT_TEST_FAILURES_OUT, failed)
			process.exit(code)
		}
	}
}

if (failed.length) {
	await writeFailuresOutFile(process.env.FOUNT_TEST_FAILURES_OUT, failed)
	process.exit(1)
}
