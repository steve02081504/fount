/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { MiB } from '../core/concurrency.mjs'
import {
	buildEstimateTask,
	estimateEtaMs,
	GAP_OVERHEAD_MS,
	serialSumMs,
	simulateParallelMakespanMs,
	summarizeEstimate,
} from '../core/estimate.mjs'

/** @type {import('../core/manifest.mjs').SuiteDef} */
function stubSuite(overrides = {}) {
	return {
		manifestId: 'shells/chat',
		name: 'fed_core',
		id: 'fed_core',
		run: [],
		triggers: [],
		manifestPath: 'x',
		heavy: false,
		resources: undefined,
		dependencies: [],
		...overrides,
	}
}

/** @param {Partial<import('../core/estimate.mjs').EstimateTask>} overrides 覆盖
 * @returns {import('../core/estimate.mjs').EstimateTask} 任务
 */
function task(overrides) {
	return {
		key: 'shells/chat/a',
		manifestId: 'shells/chat',
		name: 'a',
		durationMs: 1000,
		reused: false,
		memMb: 100,
		cpuPct: 10,
		heavy: false,
		deps: [],
		...overrides,
	}
}

Deno.test('serialSumMs sums non-reused durations', () => {
	assertEquals(serialSumMs([
		task({ durationMs: 1000 }),
		task({ key: 'shells/chat/b', name: 'b', durationMs: 2000, reused: true }),
		task({ key: 'shells/chat/c', name: 'c', durationMs: 500 }),
	]), 1500)
})

Deno.test('buildEstimateTask uses baseline and marks reused as zero', () => {
	const suite = stubSuite({ name: 'ws' })
	const entry = { baselineDurationMs: 18_000 }
	const fresh = buildEstimateTask(suite, entry, { reused: false })
	assertEquals(fresh.durationMs, 18_000)
	assertEquals(fresh.reused, false)

	const reused = buildEstimateTask(suite, entry, { reused: true })
	assertEquals(reused.durationMs, 0)
	assertEquals(reused.reused, true)
})

Deno.test('estimateEtaMs adds gap overhead per critical path slot', () => {
	assertEquals(estimateEtaMs(60_000, 3), 60_000 + 3 * GAP_OVERHEAD_MS)
	assertEquals(GAP_OVERHEAD_MS, 130)
})

Deno.test('simulateParallelMakespanMs packs independent light suites', () => {
	const memBudget = 3000 * MiB
	const result = simulateParallelMakespanMs([
		task({ key: 'shells/chat/a', name: 'a', durationMs: 1000, memMb: 100, cpuPct: 10 }),
		task({ key: 'shells/chat/b', name: 'b', durationMs: 1000, memMb: 100, cpuPct: 10 }),
	], { memBudgetBytes: memBudget, cpuBudgetPct: 85 })
	assertEquals(result.makespanMs, 1000)
	assertEquals(result.criticalPathCount, 1)
})

Deno.test('simulateParallelMakespanMs serializes heavy suites exclusively', () => {
	const memBudget = 8000 * MiB
	const result = simulateParallelMakespanMs([
		task({ key: 'p2p/sim', manifestId: 'p2p', name: 'sim', durationMs: 2000, heavy: true, memMb: 800, cpuPct: 92 }),
		task({ key: 'shells/chat/pure', name: 'pure', durationMs: 1000, memMb: 100, cpuPct: 5 }),
	], { memBudgetBytes: memBudget, cpuBudgetPct: 85 })
	assertEquals(result.makespanMs, 3000)
	assertEquals(result.criticalPathCount, 2)
})

Deno.test('simulateParallelMakespanMs respects dependency chain', () => {
	const memBudget = 8000 * MiB
	const result = simulateParallelMakespanMs([
		task({ key: 'shells/chat/ws', name: 'ws', durationMs: 1000, deps: [] }),
		task({ key: 'shells/chat/ws_rpc', name: 'ws_rpc', durationMs: 2000, deps: ['shells/chat/ws'] }),
	], { memBudgetBytes: memBudget, cpuBudgetPct: 85 })
	assertEquals(result.makespanMs, 3000)
	assertEquals(result.criticalPathCount, 2)
})

Deno.test('simulateParallelMakespanMs counts resource serialization on critical path', () => {
	const memBudget = 150 * MiB
	const result = simulateParallelMakespanMs([
		task({ key: 'shells/chat/a', name: 'a', durationMs: 1000, memMb: 100, cpuPct: 10 }),
		task({ key: 'shells/chat/b', name: 'b', durationMs: 1000, memMb: 100, cpuPct: 10 }),
	], { memBudgetBytes: memBudget, cpuBudgetPct: 85 })
	assertEquals(result.makespanMs, 2000)
	assertEquals(result.criticalPathCount, 2)
})

Deno.test('simulateParallelMakespanMs skips reused zero-duration tasks on critical path', () => {
	const memBudget = 8000 * MiB
	const result = simulateParallelMakespanMs([
		task({ key: 'shells/chat/a', name: 'a', durationMs: 0, reused: true }),
		task({ key: 'shells/chat/b', name: 'b', durationMs: 1000, deps: ['shells/chat/a'] }),
	], { memBudgetBytes: memBudget, cpuBudgetPct: 85 })
	assertEquals(result.makespanMs, 1000)
	assertEquals(result.criticalPathCount, 1)
})

Deno.test('summarizeEstimate chooses serial sum in serial mode', () => {
	const tasks = [
		task({ durationMs: 1000 }),
		task({ key: 'shells/chat/b', name: 'b', durationMs: 2000 }),
	]
	const summary = summarizeEstimate(tasks, {
		serial: true,
		memBudgetBytes: 8000 * MiB,
		cpuBudgetPct: 85,
	})
	assertEquals(summary.serialSumMs, 3000)
	assertEquals(summary.chosenMakespanMs, 3000)
	assertEquals(summary.gapCount, 2)
	assertEquals(summary.etaMs, 3000 + 2 * GAP_OVERHEAD_MS)
	assertEquals(summary.savingsMs, 1000)
	assertEquals(summary.parallelMakespanMs, 2000)
	assertEquals(summary.parallelGapCount, 1)
	assertEquals(summary.parallelEtaMs, 2000 + GAP_OVERHEAD_MS)
})

Deno.test('summarizeEstimate uses parallel makespan when not serial', () => {
	const tasks = [
		task({ durationMs: 1000, memMb: 100, cpuPct: 10 }),
		task({ key: 'shells/chat/b', name: 'b', durationMs: 1000, memMb: 100, cpuPct: 10 }),
	]
	const summary = summarizeEstimate(tasks, {
		serial: false,
		memBudgetBytes: 8000 * MiB,
		cpuBudgetPct: 85,
	})
	assertEquals(summary.chosenMakespanMs, 1000)
	assertEquals(summary.gapCount, 1)
	assertEquals(summary.etaMs, 1000 + GAP_OVERHEAD_MS)
	assertEquals(summary.parallelRatePct, 100)
})
