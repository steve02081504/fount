/**
 * 串行执行 Deno test。
 *
 * 目录参数会展开为各 *.test.mjs，每个文件在独立子进程中运行，
 * 避免集成 harness 在同一进程内堆积多个 server 实例导致 OOM。
 *
 *   deno run -A src/scripts/test/serial_deno_test.mjs -- ./src/public/parts/shells/social/test/
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const args = process.argv.slice(2)

/**
 * 递归收集目录下所有 *.test.mjs（跳过 live/ 与 frontend/）。
 * @param {string} dir - 起始目录。
 * @returns {string[]} 排序后的测试文件绝对路径。
 */
function collectTestFiles(dir) {
	/** @type {string[]} */
	const files = []
	for (const name of readdirSync(dir)) {
		const path = join(dir, name)
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
 * 同步执行子进程；非零退出码时终止当前进程。
 * @param {string[]} command - 可执行文件与参数。
 * @returns {void}
 */
function run(command) {
	const [executable, ...rest] = command
	const out = spawnSync(executable, rest, { cwd: REPO_ROOT, stdio: 'inherit' })
	if (out.status) process.exit(out.status ?? 1)
}

if (!args.length) {
	console.error('usage: serial_deno_test.mjs <deno-test-path> [...]')
	process.exit(2)
}

/** @type {string[]} */
const testFiles = []
for (const arg of args) {
	if (arg.startsWith('--')) continue
	const path = resolve(REPO_ROOT, arg)
	if (statSync(path).isDirectory())
		testFiles.push(...collectTestFiles(path))
	else
		testFiles.push(path)
}

const ignore = args.find(a => a.startsWith('--ignore='))?.slice('--ignore='.length)
const ignorePrefix = ignore ? resolve(REPO_ROOT, ignore) : null

const denoBase = ['test', '--no-check', '--allow-all', '-c', './deno.json']

for (const file of testFiles) {
	if (ignorePrefix && file.startsWith(ignorePrefix)) continue
	run(['deno', ...denoBase, file])
}
