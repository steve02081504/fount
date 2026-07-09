/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { MiB } from '../core/concurrency.mjs'
import {
	buildEstimateTask,
	buildEstimateTasksFromPlan,
	estimateEtaMs,
	GAP_OVERHEAD_MS,
	serialSumMs,
	simulateParallelMakespanMs,
	summarizeEstimate,
} from '../core/estimate.mjs'
import { buildPlan } from '../core/plan.mjs'
import { suiteKey } from '../core/state.mjs'
import { buildVerdicts } from '../core/verdict.mjs'

import { makeStateEntry, makeSuite } from './fixtures.mjs'

/**
 * @param {Partial<import('../core/estimate.mjs').EstimateTask>} overrides 覆盖字段
 * @returns {import('../core/estimate.mjs').EstimateTask} 预估任务
 */
function task(overrides) {
	return {
		key: 'shells/chat/a',
		manifestId: 'shells/chat',
		name: 'a',
		durationMs: 1000,
		reused: false,
		blocked: false,
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

Deno.test('buildEstimateTasksFromPlan mirrors plan actions', () => {
	const all = [
		makeSuite('server', 'live'),
		makeSuite('shells/chat', 'smoke', { dependsOn: ['server:live'] }),
	]
	const byKey = new Map(all.map(s => [suiteKey(s.manifestId, s.name), s]))
	const state = {
		suites: {
			'server/live': makeStateEntry({ status: 'failed' }),
			'shells/chat/smoke': makeStateEntry({ status: 'passed', baselineDurationMs: 2000 }),
		},
	}
	const verdicts = buildVerdicts(all, state, new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])), new Map())
	const plan = buildPlan(new Set(['shells/chat/smoke']), verdicts, byKey, all)
	const tasks = buildEstimateTasksFromPlan(plan.slots, state)
	assertEquals(tasks.map(t => [t.key, t.reused, t.blocked, t.durationMs]), [
		['server/live', true, false, 0],
		['shells/chat/smoke', false, true, 2000],
	])
	assertEquals(serialSumMs(tasks), 0)
})

Deno.test('buildEstimateTask uses baseline and marks reused as zero', () => {
	const suite = makeSuite('shells/chat', 'ws')
	const stateEntry = { baselineDurationMs: 18_000 }
	const fresh = buildEstimateTask(suite, stateEntry, { reused: false })
	assertEquals(fresh.durationMs, 18_000)
	const reused = buildEstimateTask(suite, stateEntry, { reused: true })
	assertEquals(reused.durationMs, 0)
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
})

Deno.test('summarizeEstimate reports run/reused/blocked breakdown', () => {
	const tasks = [
		task({ durationMs: 1000 }),
		task({ key: 'shells/chat/b', name: 'b', durationMs: 2000, reused: true }),
		task({ key: 'shells/chat/c', name: 'c', durationMs: 3000, blocked: true }),
	]
	const summary = summarizeEstimate(tasks, {
		serial: true,
		memBudgetBytes: 8000 * MiB,
		cpuBudgetPct: 85,
	})
	assertEquals(summary.runCount, 1)
	assertEquals(summary.reusedCount, 1)
	assertEquals(summary.blockedCount, 1)
})
