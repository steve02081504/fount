/**
 * 内核链接速度基准：Deno 模块图 load/link/typecheck/求值开销拆分。
 *
 *   - `deno cache`：模块图解析 + 类型检查 + 转译（跨进程复用缓存）
 *   - 每次 run 的 spawn→preload：Deno 初始化 + 模块图 load/link
 *   - preload→mainEval：模块图求值
 *   - mainEval→listening：内核逻辑（catalog 等）
 *
 * 用法（仓库根）：
 *   deno run --allow-scripts --allow-all -c ./deno.json ./src/scripts/test/tools/bench/kernel_link.mjs [迭代次数=3]
 */
/* global Deno */
import { execFile as execFileCallback } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { pickAvailableIpcPort, TEST_PORT_BASE } from '../../core/ports.mjs'
import { REPO_ROOT } from '../../core/repo_root.mjs'
import { testHubUrl } from '../../hub/index.mjs'
import { kernelHealthy, shutdownTestKernel, spawnDetachedKernel } from '../../kernel/ensure.mjs'

import { fmt, renderTable, row, withTempDir } from './common.mjs'

const execFile = promisify(execFileCallback)
const ITERATIONS = Math.max(1, Number(process.argv[2]) || 3)

const KERNEL_ENTRY = join(REPO_ROOT, 'src', 'scripts', 'test', 'kernel', 'index.mjs')
const PRELOAD_PROBE = fileURLToPath(new URL('./preload_probe.mjs', import.meta.url))
const BENCH_PORT_BASE = TEST_PORT_BASE + 20_000

/** 本 bench 进程的时间原点（epoch ms），用于把 performance.now() 换算成绝对时刻。 */
const BENCH_ORIGIN = performance.timeOrigin

/**
 * 等待内核 healthy 且两个 marker 文件都落盘。
 * @param {string} url hub URL
 * @param {string} phaseFile 相位文件
 * @param {string} preloadFile preload 探针文件
 * @returns {Promise<{ phases: object | null, preload: object | null }>} marker 数据
 */
async function waitMarkers(url, phaseFile, preloadFile) {
	const deadline = Date.now() + 60_000
	while (Date.now() < deadline) {
		// 先探活（Windows 上 fetch 可能阻塞到 1.5s 超时），healthy 后再读 marker；
		// 文件未齐则继续轮询，避免读与写之间的竞态。
		if (!await kernelHealthy(url)) {
			await new Promise(resolve => { setTimeout(resolve, 100) })
			continue
		}
		const phases = await readFile(phaseFile, 'utf8').then(raw => JSON.parse(raw)).catch(() => null)
		const preload = await readFile(preloadFile, 'utf8').then(raw => JSON.parse(raw)).catch(() => null)
		if (phases && preload)
			return { phases, preload }
		await new Promise(resolve => { setTimeout(resolve, 100) })
	}
	return { phases: null, preload: null }
}

const port = await pickAvailableIpcPort(BENCH_PORT_BASE, 50)
await shutdownTestKernel({ port }).catch(() => { })

console.log('=== 模块图 cache 开销 ===')
const cacheStart = performance.now()
await execFile(Deno.execPath(), ['cache', '--allow-scripts', '-c', join(REPO_ROOT, 'deno.json'), KERNEL_ENTRY], {
	cwd: REPO_ROOT,
	windowsHide: true,
	timeout: 120_000,
})
console.log(`deno cache：${fmt(performance.now() - cacheStart)}ms`)

console.log(`\nkernel link bench — ${ITERATIONS} 次 × port ${port}`)
console.log('')

await withTempDir('fount-bench-', async workDir => {
	/** @type {{ spawnEpoch: number, healthyEpoch: number, phases: object | null, preload: object | null, shutdownMs: number }[]} */
	const iterations = []
	for (let i = 0; i < ITERATIONS; i++) {
		const phaseFile = join(workDir, `kernel_phases_${i}.json`)
		const preloadFile = join(workDir, `preload_${i}.json`)
		const t0 = performance.now()
		await spawnDetachedKernel(port, {
			args: [`--preload=${PRELOAD_PROBE}`],
			env: {
				FOUNT_TEST_BENCH_PHASES_FILE: phaseFile,
				FOUNT_TEST_BENCH_PRELOAD_FILE: preloadFile,
			},
		})
		const spawnEpoch = BENCH_ORIGIN + t0
		const { phases, preload } = await waitMarkers(testHubUrl(port), phaseFile, preloadFile)
		const healthyEpoch = BENCH_ORIGIN + performance.now()
		const shutdownStarted = performance.now()
		await shutdownTestKernel({ port })
		iterations.push({ spawnEpoch, healthyEpoch, phases, preload, shutdownMs: performance.now() - shutdownStarted })
		console.log(`  #${i + 1}: spawn→healthy ${fmt(healthyEpoch - spawnEpoch)}ms（shutdown ${fmt(performance.now() - shutdownStarted)}ms）`)
	}

	const totals = iterations.map(r => r.healthyEpoch - r.spawnEpoch)
	const good = iterations.filter(r => r.phases && r.preload)

	/** @type {{ name: string, samples: number[] }[]} */
	const rows = [
		{ name: 'spawn→healthy', samples: totals },
	]

	const deltas = good.map(r => {
		const kernelOrigin = r.phases.timeOrigin
		const pre = r.preload
		const preloadEpoch = pre.timeOrigin + pre.preloadEval
		const mainEval = (r.phases.phases?.mainEval ?? 0) + kernelOrigin
		const listening = (r.phases.phases?.listening ?? mainEval) + kernelOrigin
		return {
			'spawn→preload（init+link）': preloadEpoch - r.spawnEpoch,
			'preload→mainEval（图求值）': mainEval - preloadEpoch,
			'mainEval→listening（内核逻辑）': listening - mainEval,
			'listening→healthy（外部轮询）': Math.max(0, r.healthyEpoch - listening),
		}
	})

	const names = ['spawn→preload（init+link）', 'preload→mainEval（图求值）', 'mainEval→listening（内核逻辑）', 'listening→healthy（外部轮询）']
	for (const name of names) {
		const samples = deltas.map(d => d[name]).filter(v => Number.isFinite(v))
		if (samples.length)
			rows.push({ name, samples })
	}

	console.log(renderTable('内核链接（各相位 min / 中位 / max）', rows))
	console.log('')
	console.log('总计：', row(totals), 'ms（min / 中位 / max）')
	console.log('')
	console.log('注：spawn→preload 含 Deno 运行时初始化 + 模块图 load/link（每进程一次，不跨进程缓存）；')
	console.log('    deno cache 覆盖的是可跨进程复用的图解析/类型检查/转译部分。')
})