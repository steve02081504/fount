#!/usr/bin/env -S deno run -A
/* global Deno */
/**
 * P2P 参数模拟器 + 挖矿器 CLI。
 *
 * 用法:
 *   deno run -A src/scripts/p2p/sim/cli.mjs sim --scenario balanced
 *   deno run -A src/scripts/p2p/sim/cli.mjs mine --generations 20 --apply
 *   deno run -A src/scripts/p2p/sim/cli.mjs mine --duration 5m --apply
 */
import { applyTunablesBundle } from './apply.mjs'
import { parseDurationMs } from './duration.mjs'
import { DEFAULT_WEIGHTS } from './metrics.mjs'
import { runSimulation } from './model.mjs'
import { runOptimizer, shouldApply } from './optimizer.mjs'
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
	const doApply = !!args.apply
	const scenarios = resolveScenarios(scenarioId)

	if (durationMs == null && args.duration != null && args.duration !== true)
		console.warn(`warning: invalid --duration ${JSON.stringify(args.duration)}, using --generations instead`)

	const result = await runOptimizer({
		scenarios,
		generations,
		population,
		seeds,
		seedBase,
		weights: DEFAULT_WEIGHTS,
		durationMs,
	})

	const { baseline, best, history, stoppedBy, generationsRun, elapsedMs } = result

	/** @type {object} */
	const applyInfo = { applied: false, reason: 'report-only' }
	if (doApply) 
		if (shouldApply(baseline.result.fitness, best.result.fitness)) {
			const written = await applyTunablesBundle(best.tunables)
			applyInfo.applied = true
			applyInfo.written = written
		}
		else 
			applyInfo.reason = `fitness ${best.result.fitness.toFixed(4)} 未超过基线 ${baseline.result.fitness.toFixed(4)} + margin`
		
	

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

	const { jsonPath, mdPath } = await writeReport(payload, doApply ? 'mine-applied' : 'mine')
	console.log(`fitness baseline=${baseline.result.fitness.toFixed(4)} best=${best.result.fitness.toFixed(4)}`)
	if (durationMs != null)
		console.log(`stopped by ${stoppedBy} after ${generationsRun} generation(s), elapsed ${(elapsedMs / 1000).toFixed(1)}s / ${(durationMs / 1000).toFixed(1)}s`)
	console.log(`report: ${jsonPath}`)
	console.log(`report: ${mdPath}`)
	if (applyInfo.applied) console.log('applied best tunables to module JSON files')
	else if (doApply) console.log(`not applied: ${applyInfo.reason}`)
}

const args = parseArgs(Deno.args)
const cmd = args._[0] || 'mine'

if (cmd === 'sim') await cmdSim(args)
else if (cmd === 'mine') await cmdMine(args)
else {
	console.error(`unknown command: ${cmd}`)
	console.error('usage: cli.mjs [sim|mine] [--scenario ID] [--generations N] [--duration 5m] [--seeds 1,2,3] [--apply]')
	Deno.exit(1)
}
