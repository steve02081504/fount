/**
 * `fount` CLI 启动速度基准：launcher 地板（`fount nop`）与 `fount eval` 回显，
 * 对照 `deno eval` / `pwsh -NoProfile -c 1` / `powershell.exe -NoProfile -c 1` 的解释器启动成本。
 *
 * `fount eval` 行仅在 `data/config.json` 的端口上有运行中的服务器时测量，否则跳过并说明。
 *
 * 用法（仓库根）：
 *   deno run --allow-scripts --allow-all -c ./deno.json ./src/scripts/test/tools/bench/cli_startup.mjs [迭代次数=5]
 */
/* global Deno */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

import { REPO_ROOT } from '../../core/repo_root.mjs'

import { renderTable } from './common.mjs'

const ITERATIONS = Math.max(1, Number(process.argv[2]) || 5)

/**
 * 用 where/which 解析 PATH 上的可执行文件。
 * @param {string} name 可执行名
 * @returns {string | null} 首个匹配路径
 */
function resolveExecutable(name) {
	const probe = Deno.build.os === 'windows'
		? new Deno.Command('where.exe', { args: [name], stdout: 'piped', stderr: 'null' })
		: new Deno.Command('which', { args: [name], stdout: 'piped', stderr: 'null' })
	try {
		const output = probe.outputSync()
		if (!output.success) return null
		const first = new TextDecoder().decode(output.stdout).split(/\r?\n/u).map(line => line.trim()).find(Boolean)
		return first || null
	}
	catch {
		return null
	}
}

/**
 * 运行一个命令若干次并收集单次墙钟耗时（ms）。
 * @param {string} executable 可执行路径
 * @param {string[]} args 参数
 * @param {number} [iterations] 迭代次数
 * @returns {number[]} 每次耗时样本
 */
function measure(executable, args, iterations = ITERATIONS) {
	const samples = []
	for (let index = 0; index < iterations; index++) {
		const startedAt = performance.now()
		const result = new Deno.Command(executable, {
			args,
			stdout: 'null',
			stderr: 'null',
		}).outputSync()
		samples.push(performance.now() - startedAt)
		if (!result.success)
			throw new Error(`${executable} ${args.join(' ')} exited with ${result.code}`)
	}
	return samples
}

/**
 * 读取运行中服务器的端口（`data/config.json`，失败回落 8931）。
 * @returns {Promise<number>} 端口
 */
async function readServerPort() {
	try {
		const config = JSON.parse(await readFile(join(REPO_ROOT, 'data', 'config.json'), 'utf8'))
		if (Number.isFinite(config?.port)) return config.port
	}
	catch { /* 使用默认端口 */ }
	return 8931
}

/**
 * 探测 fount 服务器是否在线（`/api/ping` 返回 pong）。
 * @param {number} port 端口
 * @returns {Promise<boolean>} 是否在线
 */
async function serverOnline(port) {
	try {
		const response = await fetch(`http://localhost:${port}/api/ping`, { signal: AbortSignal.timeout(2000) })
		return response.ok && (await response.json())?.message === 'pong'
	}
	catch {
		return false
	}
}

/** @type {{ name: string, samples: number[] }[]} */
const rows = []

rows.push({ name: 'deno eval "1"', samples: measure(Deno.execPath(), ['eval', '1']) })

const pwshPath = resolveExecutable('pwsh')
if (pwshPath)
	rows.push({ name: 'pwsh -NoProfile -c 1', samples: measure(pwshPath, ['-NoProfile', '-Command', '1']) })
else
	console.log('（找不到 pwsh，跳过）')

if (Deno.build.os === 'windows') {
	const windowsPowerShellPath = resolveExecutable('powershell.exe')
	if (windowsPowerShellPath)
		rows.push({ name: 'powershell.exe -NoProfile -c 1', samples: measure(windowsPowerShellPath, ['-NoProfile', '-Command', '1']) })
}

const fountPath = resolveExecutable('fount')
if (fountPath) {
	rows.push({ name: 'fount nop（launcher 地板）', samples: measure(fountPath, ['nop']) })
	const port = await readServerPort()
	if (await serverOnline(port))
		rows.push({ name: `fount eval "1"（:${port} 在线）`, samples: measure(fountPath, ['eval', '1']) })
	else
		console.log(`（localhost:${port} 无运行中的服务器，跳过 fount eval）`)
}
else 
	console.log('（PATH 上没有 fount，跳过 launcher 行）')


console.log('')
console.log(renderTable(`CLI 启动（${ITERATIONS} 次，min / 中位 / max，ms）`, rows))
