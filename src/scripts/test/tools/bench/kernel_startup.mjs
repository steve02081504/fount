/**
 * 内核启动速度基准：spawn 到 healthy，含进程内相位拆分（链接/图求值/catalog/绑定）。
 *
 * 用法（仓库根）：
 *   deno run --allow-scripts --allow-all -c ./deno.json ./src/scripts/test/tools/bench/kernel_startup.mjs [迭代次数=3]
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

import { pickAvailableIpcPort, TEST_PORT_BASE } from '../../core/ports.mjs'
import { testHubUrl } from '../../hub/index.mjs'
import { kernelHealthy, shutdownTestKernel, spawnDetachedKernel } from '../../kernel/ensure.mjs'

import { fmt, renderTable, row, stats, withTempDir } from './common.mjs'

const ITERATIONS = Math.max(1, Number(process.argv[2]) || 3)

/** bench 专用端口（避开生产 8903 与测试节点段）。 */
const BENCH_PORT_BASE = TEST_PORT_BASE + 20_000

/** 本 bench 进程的时间原点（epoch ms），用于把 performance.now() 换算成绝对时刻。 */
const BENCH_ORIGIN = performance.timeOrigin

/**
 * 等待内核 healthy 且相位文件落盘。
 * @param {string} url hub URL
 * @param {string} phaseFile 相位文件
 * @returns {Promise<object | null>} 相位数据；超时返回 null
 */
async function waitHealthyAndPhases(url, phaseFile) {
	const deadline = Date.now() + 60_000
	while (Date.now() < deadline) {
		// 先探活（Windows 上 fetch 可能阻塞到 1.5s 超时），healthy 后再读相位文件；
		// 文件尚未落盘则继续轮询，避免读与写之间的竞态。
		if (!await kernelHealthy(url)) {
			await new Promise(resolve => { setTimeout(resolve, 100) })
			continue
		}
		try {
			return JSON.parse(await readFile(phaseFile, 'utf8'))
		}
		catch { /* 相位文件尚未写入，继续等 */ }
		await new Promise(resolve => { setTimeout(resolve, 100) })
	}
	return null
}

/**
 * 单次内核启动迭代。
 * @param {number} port 端口
 * @param {string} phaseFile 相位文件路径
 * @returns {Promise<{ spawnEpoch: number, healthyEpoch: number, spawnMs: number, phases: object, shutdownMs: number }>} 迭代结果
 */
async function runOnce(port, phaseFile) {
	const startedAt = performance.now()
	await spawnDetachedKernel(port, { env: { FOUNT_TEST_BENCH_PHASES_FILE: phaseFile } })
	const spawnMs = performance.now() - startedAt
	const url = testHubUrl(port)
	const phases = await waitHealthyAndPhases(url, phaseFile)
	if (phases === null)
		throw new Error(`kernel did not become healthy within 60s at ${url}`)
	const healthyEpoch = BENCH_ORIGIN + performance.now()
	const shutdownStarted = performance.now()
	await shutdownTestKernel({ port })
	return {
		/** 本迭代内核进程的估算起点（epoch ms）。 */
		spawnEpoch: BENCH_ORIGIN + startedAt,
		healthyEpoch,
		spawnMs,
		phases,
		shutdownMs: performance.now() - shutdownStarted,
	}
}

/**
 * 从相位数据提取各阶段绝对时刻（epoch ms）。
 * @param {object} phases 相位文件内容
 * @returns {{ abs: Record<string, number>, timeOrigin: number }} 绝对时刻
 */
function toAbsolute(phases) {
	const timeOrigin = phases?.timeOrigin ?? 0
	/** @type {Record<string, number>} */
	const abs = {}
	for (const [name, now] of Object.entries(phases?.phases ?? {}))
		abs[name] = timeOrigin + Number(now)
	return { abs, timeOrigin }
}

const port = await pickAvailableIpcPort(BENCH_PORT_BASE, 50)
await shutdownTestKernel({ port }).catch(() => { })

console.log(`kernel startup bench — ${ITERATIONS} 次 × port ${port}`)
console.log('')

await withTempDir('fount-bench-', async workDir => {
	/** @type {object[]} */
	const iterations = []
	for (let iterationIndex = 0; iterationIndex < ITERATIONS; iterationIndex++) {
		const phaseFile = join(workDir, `kernel_phases_${iterationIndex}.json`)
		const result = await runOnce(port, phaseFile)
		iterations.push(result)
		const totalMs = result.healthyEpoch - result.spawnEpoch
		console.log(`  #${iterationIndex + 1}: spawn→healthy ${fmt(totalMs)}ms (shutdown ${fmt(result.shutdownMs)}ms)`)
	}

	const totals = iterations.map(r => r.healthyEpoch - r.spawnEpoch)
	const spawns = iterations.map(r => r.spawnMs)
	const shutdowns = iterations.map(r => r.shutdownMs)

	/** 有相位数据的迭代（取中位数那次用于明细）。 */
	const withPhases = iterations.filter(r => r.phases)
	const medianTotal = stats(totals).median
	const medianIter = withPhases.find(r => Math.abs((r.healthyEpoch - r.spawnEpoch) - medianTotal) === Math.min(...withPhases.map(x => Math.abs((x.healthyEpoch - x.spawnEpoch) - medianTotal)))) ?? withPhases[0]

	/** @type {{ name: string, samples: number[] }[]} */
	const rows = [
		{ name: 'spawn→healthy', samples: totals },
		{ name: 'spawn 返回', samples: spawns },
		{ name: 'healthy 轮询粒度', samples: withPhases.map(it => {
			const { abs } = toAbsolute(it.phases)
			return abs.startReady != null ? Math.max(0, it.healthyEpoch - abs.startReady) : 0
		}) },
		{ name: 'shutdown（收尾）', samples: shutdowns },
	]

	/** @type {string[]} */
	const phaseNames = [
		'init+link（spawn→timeOrigin）',
		'timeOrigin→mainEval（图求值）',
		'catalogLoad',
		'bind（express→listening）',
		'postListen→startReady',
	]
	const namedDeltas = iterations.map(r => {
		if (!r.phases) return null
		const { abs } = toAbsolute(r.phases)
		return {
			'init+link（spawn→timeOrigin）': r.phases.timeOrigin - r.spawnEpoch,
			'timeOrigin→mainEval（图求值）': (abs.mainEval ?? r.phases.timeOrigin) - r.phases.timeOrigin,
			catalogLoad: (abs.catalogReady ?? abs.mainEval) - (abs.catalogStart ?? abs.mainEval),
			'bind（express→listening）': (abs.listening ?? abs.expressReady) - (abs.expressReady ?? abs.listening),
			'postListen→startReady': (abs.startReady ?? abs.listening) - (abs.listening ?? abs.startReady),
		}
	})
	for (const name of phaseNames) {
		const samples = namedDeltas.map(d => d?.[name]).filter(v => v != null && Number.isFinite(v))
		if (samples.length)
			rows.push({ name, samples })
	}

	console.log(renderTable('内核启动（各相位 min / 中位 / max）', rows))

	if (medianIter?.phases) {
		const { abs, timeOrigin } = toAbsolute(medianIter.phases)
		console.log('')
		console.log(`中位迭代相位明细（spawn=${fmt(timeOrigin - medianIter.spawnEpoch)}ms 后，总 ${fmt(medianIter.healthyEpoch - medianIter.spawnEpoch)}ms）：`)
		console.log('| 相位 | 距 timeOrigin |')
		console.log('| --- | --- |')
		for (const name of ['mainEval', 'kernelConstructed', 'catalogStart', 'catalogReady', 'loopReady', 'expressReady', 'listening', 'wsReady', 'startReady']) 
			if (abs[name] != null)
				console.log(`| ${name} | ${fmt(abs[name] - timeOrigin)} |`)
		
		console.log(`| healthy（外部） | ${fmt(medianIter.healthyEpoch - timeOrigin)} |`)
	}

	console.log('')
	console.log('总计：', row(totals), 'ms（min / 中位 / max）')
})