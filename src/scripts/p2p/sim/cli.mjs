#!/usr/bin/env -S deno run -A
/* global Deno */
/**
 * P2P 参数模拟器 + 挖矿器 CLI。
 *
 * 用法:
 *   deno run -A src/scripts/p2p/sim/cli.mjs sim --scenario balanced
 *   deno run -A src/scripts/p2p/sim/cli.mjs mine --generations 20
 *   deno run -A src/scripts/p2p/sim/cli.mjs mine --duration 5m
 *   deno run -A src/scripts/p2p/sim/cli.mjs mine --duration 5m --no-apply
 */
import { applyTunablesBundle } from './apply.mjs'
import { parseDurationMs } from './duration.mjs'
import { DEFAULT_WEIGHTS, evaluateTunables } from './metrics.mjs'
import { runSimulation } from './model.mjs'
import { runOptimizer, shouldApplyResult } from './optimizer.mjs'
import { writeReport } from './report.mjs'
import { resolveScenarios } from './scenarios.mjs'
import { loadDefaultTunables } from './tunables_bundle.mjs'

/**
 * @param {string[]} argv CLI 参数（不含 node/脚本路径）
 * @returns {Record<string, string | boolean> & { _: string[] }} 解析结果（`_` 为位置参数）
 */
function parseArgs(argv) {
	/** @type {Record<string, string | boolean> & { _: string[] }} */
	const out = { _: [] }
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg.startsWith('--')) {
			const key = arg.slice(2)
			const next = argv[i + 1]
			if (!next || next.startsWith('--')) out[key] = true
			else {
				out[key] = next
				i++
			}
		}
		else out._.push(arg)
	}
	return out
}

/**
 * @param {string | boolean | undefined} raw 原始参数值
 * @param {number} fallback 解析失败时的默认值
 * @returns {number} 数值
 */
function num(raw, fallback) {
	const n = Number(raw)
	return Number.isFinite(n) ? n : fallback
}

/**
 * @param {string | boolean | undefined} raw 原始参数值
 * @returns {number[]} 种子列表
 */
function parseSeeds(raw) {
	if (typeof raw !== 'string') return [1, 2, 3]
	return raw.split(',').map(s => Number(s.trim())).filter(Number.isFinite)
}

/**
 * @param {number | null} durationMs 时长上限
 * @param {number} generations 代数上限
 * @returns {(info: import('./optimizer.mjs').OptimizerProgress) => void} 进度打印器
 */
function createProgressPrinter(durationMs, generations) {
	const isTty = typeof Deno.stdout.isTerminal === 'function' && Deno.stdout.isTerminal()
	let lastWrite = 0
	const encoder = new TextEncoder()

	return (info) => {
		const now = Date.now()
		if (now - lastWrite < 200 && info.generation > 0) return
		lastWrite = now

		const pct = info.percent.toFixed(1)
		const elapsed = (info.elapsedMs / 1000).toFixed(1)
		const limit = durationMs != null ? `${(durationMs / 1000).toFixed(1)}` : `${generations}`
		const line = `mining ${pct}% | gen ${info.generationsRun} | best ${info.bestFitness.toFixed(4)} | mean ${info.meanFitness.toFixed(4)} | ${elapsed}s/${limit}${durationMs != null ? 's' : ' gen'}`

		if (isTty)
			Deno.stdout.writeSync(encoder.encode(`\r${line.padEnd(80)}`))
		else if (info.generation === 0 || info.generationsRun % 10 === 0)
			console.log(line)
	}
}

/**
 * @param {Record<string, string | boolean> & { _: string[] }} args 已解析参数
 * @returns {Promise<void>}
 */
async function cmdSim(args) {
	const scenarioId = String(args.scenario || args.scenarios || 'balanced')
	const seeds = parseSeeds(args.seeds)
	const tunables = loadDefaultTunables()
	const scenarios = resolveScenarios(scenarioId)

	for (const scenario of scenarios)
		for (const seed of seeds) {
			const snap = runSimulation(scenario, seed, tunables)
			console.log(JSON.stringify({ scenario: scenario.id, seed, snap }, null, 2))
		}
}

/**
 * @param {Record<string, string | boolean> & { _: string[] }} args 已解析参数
 * @returns {Promise<void>}
 */
async function cmdMine(args) {
	const scenarioId = String(args.scenarios || args.scenario || 'all')
	const generations = num(args.generations, 20)
	const population = num(args.population, 12)
	const seeds = parseSeeds(args.seeds)
	const seedBase = num(args.seedBase, 42)
	const durationMs = parseDurationMs(args.duration)
	const doApply = !(args['no-apply'] || args['dry-run'])
	const scenarios = resolveScenarios(scenarioId)

	if (durationMs == null && args.duration != null && args.duration !== true)
		console.warn(`warning: invalid --duration ${JSON.stringify(args.duration)}, using --generations instead`)

	const onProgress = createProgressPrinter(durationMs, generations)

	const result = await runOptimizer({
		scenarios,
		generations,
		population,
		seeds,
		seedBase,
		weights: DEFAULT_WEIGHTS,
		durationMs,
		onProgress,
	})

	if (typeof Deno.stdout.isTerminal === 'function' && Deno.stdout.isTerminal())
		console.log('')

	const { baseline, best, history, stoppedBy, generationsRun, elapsedMs } = result

	// 写回前一律在**全场景**上复评，避免单场景挖矿过拟合后污染全局默认值。
	const allScenarios = resolveScenarios('all')
	const baselineFull = await evaluateTunables(allScenarios, seeds, baseline.tunables, runSimulation, DEFAULT_WEIGHTS)
	const bestFull = await evaluateTunables(allScenarios, seeds, best.tunables, runSimulation, DEFAULT_WEIGHTS)
	const gate = shouldApplyResult(baselineFull, bestFull)

	/** @type {object} */
	const applyInfo = {
		applied: false,
		reason: doApply ? gate.reason : 'dry-run',
		full: { baseline: baselineFull.fitness, best: bestFull.fitness },
	}
	if (doApply && gate.ok) {
		const written = await applyTunablesBundle(best.tunables)
		applyInfo.applied = true
		applyInfo.written = written
	}

	const payload = {
		generatedAt: new Date().toISOString(),
		scenarios: scenarios.map(s => s.id),
		seeds,
		generations: durationMs != null ? null : generations,
		population,
		durationMs,
		elapsedMs,
		stoppedBy,
		generationsRun,
		baseline: { result: baseline.result, tunables: baseline.tunables },
		best: { result: best.result, tunables: best.tunables },
		history,
		apply: applyInfo,
	}

	const { jsonPath, mdPath } = await writeReport(payload, applyInfo.applied ? 'mine-applied' : 'mine')
	console.log(`fitness baseline=${baseline.result.fitness.toFixed(4)} best=${best.result.fitness.toFixed(4)}`)
	console.log(`all-scenario fitness baseline=${baselineFull.fitness.toFixed(4)} best=${bestFull.fitness.toFixed(4)}`)
	if (durationMs != null)
		console.log(`stopped by ${stoppedBy} after ${generationsRun} generation(s), elapsed ${(elapsedMs / 1000).toFixed(1)}s / ${(durationMs / 1000).toFixed(1)}s`)
	console.log(`report: ${jsonPath}`)
	console.log(`report: ${mdPath}`)
	if (applyInfo.applied) console.log('applied best tunables to module JSON files')
	else if (doApply) console.log(`not applied: ${applyInfo.reason}`)
	else console.log('dry-run: tunables not written (use default apply; pass --no-apply to suppress)')
}

/**
 *
 */
function printHelp() {
	console.log(`usage:
  cli.mjs sim [--scenario ID] [--seeds 1,2,3]
  cli.mjs mine [--scenarios ID|all] [--generations N] [--duration 5m]
               [--population N] [--seeds 1,2,3] [--no-apply|--dry-run]

默认 mine 会将最优参数写回各模块 JSON（需超过基线 + margin）。
加 --no-apply 或 --dry-run 仅生成报告。`)
}

const args = parseArgs(Deno.args)
const cmd = args._[0] || 'mine'

if (args.help || args.h) printHelp()
else if (cmd === 'sim') await cmdSim(args)
else if (cmd === 'mine') await cmdMine(args)
else {
	console.error(`unknown command: ${cmd}`)
	printHelp()
	Deno.exit(1)
}
