/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { MiB } from '../core/concurrency.mjs'
import {
	buildEstimateTask,
	buildEstimateTasksFromPlan,
	clampRemainingMs,
	estimateEtaMs,
	expectedRunDurationMs,
	GAP_OVERHEAD_MS,
	REMAINING_JITTER_MS,
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
		key: 'shells/chat:a',
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
		task({ key: 'shells/chat:b', name: 'b', durationMs: 2000, reused: true }),
		task({ key: 'shells/chat:c', name: 'c', durationMs: 500 }),
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
			'server:live': makeStateEntry({ status: 'failed' }),
			'shells/chat:smoke': makeStateEntry({ status: 'passed', baselineDurationMs: 2000 }),
		},
	}
	const verdicts = buildVerdicts(all, state, new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])), new Map())
	const plan = buildPlan(new Set(['shells/chat:smoke']), verdicts, byKey, all)
	const tasks = buildEstimateTasksFromPlan(plan.slots, state)
	assertEquals(tasks.map(t => [t.key, t.reused, t.blocked, t.durationMs]), [
		['server:live', true, false, 0],
		['shells/chat:smoke', false, true, 2000],
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

Deno.test('expectedRunDurationMs without subtests uses suite baseline', () => {
	const suite = makeSuite('shells/chat', 'ws')
	assertEquals(expectedRunDurationMs(suite, makeStateEntry({ baselineDurationMs: 12_000 })), 12_000)
	assertEquals(expectedRunDurationMs(suite, undefined), null)
})

Deno.test('expectedRunDurationMs without subtests falls back to manifest expected', () => {
	const suite = makeSuite('shells/chat', 'ws', { expectedMs: 16_000 })
	assertEquals(expectedRunDurationMs(suite, undefined), 16_000)
	assertEquals(expectedRunDurationMs(suite, makeStateEntry({ baselineDurationMs: 12_000 })), 12_000)
})

Deno.test('expectedRunDurationMs sums overhead and selected subtests', () => {
	const suite = makeSuite('shells/social', 'frontend', {
		subtests: [
			{ name: 'feed', spec: 'feed.spec.mjs', triggers: [] },
			{ name: 'profile', spec: 'profile.spec.mjs', triggers: [] },
			{ name: 'smoke', spec: 'smoke.spec.mjs', triggers: [] },
		],
	})
	const entry = makeStateEntry({
		baselineDurationMs: 90_000,
		baselineOverheadMs: 10_000,
		subtests: {
			feed: { status: 'passed', commitHash: 'abc', uncommittedHash: null, ranAt: '', durationMs: 20_000, triggerHash: null },
			profile: { status: 'passed', commitHash: 'abc', uncommittedHash: null, ranAt: '', durationMs: 30_000, triggerHash: null },
			smoke: { status: 'passed', commitHash: 'abc', uncommittedHash: null, ranAt: '', durationMs: 15_000, triggerHash: null },
		},
	})
	assertEquals(expectedRunDurationMs(suite, entry, ['feed']), 30_000)
	assertEquals(expectedRunDurationMs(suite, entry, ['feed', 'profile']), 60_000)
	// 全量跑用实测墙钟基线（已含内部并行），而非 Σ 子测试
	assertEquals(expectedRunDurationMs(suite, entry), 90_000)
})

Deno.test('expectedRunDurationMs prefers baseline over inflated subtest sum on full run', () => {
	// 内部并行套件（如 frontend）Σ 子测试远超实测墙钟：双计造成 ETA 高估。
	const suite = makeSuite('shells/social', 'frontend', {
		subtests: [
			{ name: 'dmChannel', spec: 'dmChannel.spec.mjs', triggers: [] },
			{ name: 'navigation', spec: 'navigation.spec.mjs', triggers: [] },
		],
	})
	const entry = makeStateEntry({
		baselineDurationMs: 600_000,
		baselineOverheadMs: 140_000,
		subtests: {
			dmChannel: { status: 'passed', commitHash: 'abc', uncommittedHash: null, ranAt: '', durationMs: 605_000, triggerHash: null },
			navigation: { status: 'passed', commitHash: 'abc', uncommittedHash: null, ranAt: '', durationMs: 172_000, triggerHash: null },
		},
	})
	// 旧行为返回 605_000 + 172_000 + 140_000 = 917_000，明显高估
	assertEquals(expectedRunDurationMs(suite, entry), 600_000)
	// 子集仍按子测试求和
	assertEquals(expectedRunDurationMs(suite, entry, ['dmChannel']), 745_000)
})

Deno.test('expectedRunDurationMs falls back to known mean for missing subtest', () => {
	const suite = makeSuite('shells/social', 'frontend', {
		subtests: [
			{ name: 'feed', spec: 'feed.spec.mjs', triggers: [] },
			{ name: 'profile', spec: 'profile.spec.mjs', triggers: [] },
		],
	})
	const entry = makeStateEntry({
		baselineDurationMs: null,
		baselineOverheadMs: 5_000,
		subtests: {
			feed: { status: 'passed', commitHash: 'abc', uncommittedHash: null, ranAt: '', durationMs: 20_000, triggerHash: null },
		},
	})
	// profile missing → use known mean (20_000) + overhead
	assertEquals(expectedRunDurationMs(suite, entry, ['feed', 'profile']), 45_000)
})

Deno.test('expectedRunDurationMs uses manifest expected when state has no timings', () => {
	const suite = makeSuite('shells/social', 'frontend', {
		expectedMs: 75_000,
		subtests: [
			{ name: 'feed', spec: 'feed.spec.mjs', triggers: [], expectedMs: 20_000 },
			{ name: 'profile', spec: 'profile.spec.mjs', triggers: [], expectedMs: 30_000 },
			{ name: 'smoke', spec: 'smoke.spec.mjs', triggers: [], expectedMs: 15_000 },
		],
	})
	assertEquals(expectedRunDurationMs(suite, undefined, ['feed']), 30_000)
	assertEquals(expectedRunDurationMs(suite, undefined), 75_000)
})

Deno.test('clampRemainingMs never grows without queue insertion', () => {
	const prev = { ms: 60_000, at: 1000, pending: 3 }
	// 时间流逝 10s，剩余合理降到 50s；即便重排算高也钳回下限
	assertEquals(clampRemainingMs(200_000, prev, 11_000, 3), 50_000)
	// 未到阈值的小幅抖动不钳
	assertEquals(clampRemainingMs(50_500, prev, 1000, 3), 50_500)
	// 正常递减原样通过
	assertEquals(clampRemainingMs(45_000, prev, 11_000, 3), 45_000)
})

Deno.test('clampRemainingMs allows growth only on real insertion', () => {
	const prev = { ms: 60_000, at: 1000, pending: 3 }
	// 待运行项增多（新测试插队）→ 允许上涨
	assertEquals(clampRemainingMs(200_000, prev, 1000, 5), 200_000)
	// 无插队但已过墙钟 → 仍钳住
	assertEquals(clampRemainingMs(200_000, prev, 6000, 3), 55_000)
})

Deno.test('clampRemainingMs resets on first estimate or null', () => {
	assertEquals(clampRemainingMs(30_000, { ms: null, at: 0, pending: 0 }, 5, 1), 30_000)
	assertEquals(clampRemainingMs(null, { ms: 60_000, at: 1000, pending: 3 }, 6000, 3), null)
	assertEquals(REMAINING_JITTER_MS, 5000)
})

Deno.test('estimateEtaMs adds gap overhead per critical path slot', () => {
	assertEquals(estimateEtaMs(60_000, 3), 60_000 + 3 * GAP_OVERHEAD_MS)
	assertEquals(GAP_OVERHEAD_MS, 130)
})

Deno.test('simulateParallelMakespanMs packs independent light suites', () => {
	const memBudget = 3000 * MiB
	const result = simulateParallelMakespanMs([
		task({ key: 'shells/chat:a', name: 'a', durationMs: 1000, memMb: 100, cpuPct: 10 }),
		task({ key: 'shells/chat:b', name: 'b', durationMs: 1000, memMb: 100, cpuPct: 10 }),
	], { memBudgetBytes: memBudget, cpuBudgetPct: 85 })
	assertEquals(result.makespanMs, 1000)
})

Deno.test('simulateParallelMakespanMs overlaps dependent with running dep', () => {
	const result = simulateParallelMakespanMs([
		task({ key: 'server:live', name: 'live', durationMs: 30_000, memMb: 400, cpuPct: 20 }),
		task({
			key: 'shells/chat:ws_rpc',
			name: 'ws_rpc',
			durationMs: 20_000,
			memMb: 400,
			cpuPct: 20,
			deps: ['server:live'],
		}),
	], { memBudgetBytes: 8000 * MiB, cpuBudgetPct: 85 })
	// 一层乐观并行：下游与硬跑依赖重叠，墙钟 ≈ max(30s, 20s) 而非 50s
	assertEquals(result.makespanMs, 30_000)
})

Deno.test('simulateParallelMakespanMs does not let speculative finish satisfy dependents', () => {
	const result = simulateParallelMakespanMs([
		task({ key: 'server:a', name: 'a', durationMs: 30_000, memMb: 100, cpuPct: 10 }),
		task({
			key: 'server:b', name: 'b', durationMs: 20_000, memMb: 100, cpuPct: 10,
			deps: ['server:a'],
		}),
		task({
			key: 'server:c', name: 'c', durationMs: 20_000, memMb: 100, cpuPct: 10,
			deps: ['server:b'],
		}),
	], { memBudgetBytes: 8000 * MiB, cpuBudgetPct: 85 })
	// A 硬跑、B 投机；B 先结束只释放资源，须等 A 硬完成才算 B 完成，C 才能开工。
	// 墙钟 50s；禁止把 B 投机收尾当成 C 的硬就绪（40s）或三层叠成 30s。
	assertEquals(result.makespanMs, 50_000)
})

Deno.test('simulateParallelMakespanMs promotes speculative so next layer can overlap', () => {
	const result = simulateParallelMakespanMs([
		task({ key: 'server:a', name: 'a', durationMs: 30_000, memMb: 100, cpuPct: 10 }),
		task({
			key: 'server:b', name: 'b', durationMs: 50_000, memMb: 100, cpuPct: 10,
			deps: ['server:a'],
		}),
		task({
			key: 'server:c', name: 'c', durationMs: 20_000, memMb: 100, cpuPct: 10,
			deps: ['server:b'],
		}),
	], { memBudgetBytes: 8000 * MiB, cpuBudgetPct: 85 })
	// t=30 A 完、B 升级硬锚 → C 与 B 剩余重叠；墙钟 50s 而非等 B 完再跑 C 的 70s
	assertEquals(result.makespanMs, 50_000)
})

Deno.test('simulateParallelMakespanMs does not speculate on mixed hard and speculative same-key deps', () => {
	const result = simulateParallelMakespanMs([
		task({ id: 'anchor', key: 'server:other', name: 'other', durationMs: 30_000, memMb: 100, cpuPct: 10 }),
		task({ id: 'gate', key: 'server:gate', name: 'gate', durationMs: 5_000, memMb: 100, cpuPct: 10 }),
		task({
			id: 'live-spec', key: 'server:live', name: 'live', durationMs: 40_000, memMb: 100, cpuPct: 10,
			deps: ['server:other'],
		}),
		task({
			id: 'live-hard', key: 'server:live', name: 'live', durationMs: 10_000, memMb: 100, cpuPct: 10,
			deps: ['server:gate'],
		}),
		task({
			id: 'chat', key: 'shells/chat:ws', name: 'ws', durationMs: 20_000, memMb: 100, cpuPct: 10,
			deps: ['server:live'],
		}),
	], { memBudgetBytes: 8000 * MiB, cpuBudgetPct: 85 })
	// t=5 live-hard 开工时 live-spec 仍为投机占用；下游不得据此重叠。
	// t=30 other 完、live-spec 升硬后 chat 才可重叠；墙钟 50s 而非 40s。
	assertEquals(result.makespanMs, 50_000)
})

Deno.test('simulateParallelMakespanMs never leaves ready work at makespan 0', () => {
	// 与闸门同不变量：空闲 + 有活 → 必须开工，否则 ETA 塌成 0。
	const result = simulateParallelMakespanMs([
		task({ durationMs: 12_000, memMb: 1800, cpuPct: 25 }),
	], { memBudgetBytes: 500 * MiB, cpuBudgetPct: 85 })
	assertEquals(result.makespanMs, 12_000)
	const summary = summarizeEstimate([
		task({ durationMs: 12_000, memMb: 1800, cpuPct: 25 }),
	], { memBudgetBytes: 500 * MiB, cpuBudgetPct: 85 })
	assertEquals(summary.etaMs > 0, true)
	assertEquals(summary.runCount, 1)
})

Deno.test('never-run suite does not claim zero remaining', () => {
	const tasks = [buildEstimateTask(makeSuite('testkit', 'kernel'), undefined)]
	assertEquals(tasks[0].durationMs, null)
	const summary = summarizeEstimate(tasks, { memBudgetBytes: 8000 * MiB, cpuBudgetPct: 85 })
	assertEquals(summary.runCount, 1)
	assertEquals(summary.etaMs, null)
})

Deno.test('summarizeEstimate keeps known remaining when mixed with unknown duration', () => {
	const summary = summarizeEstimate([
		task({ durationMs: null }),
		task({ key: 'shells/chat:b', name: 'b', durationMs: 5000 }),
	], { memBudgetBytes: 8000 * MiB, cpuBudgetPct: 85 })
	assertEquals(summary.etaMs > 0, true)
})

Deno.test('summarizeEstimate reused-only remaining stays 0', () => {
	const summary = summarizeEstimate([
		task({ durationMs: null, reused: true }),
	], { memBudgetBytes: 8000 * MiB, cpuBudgetPct: 85 })
	assertEquals(summary.etaMs, 0)
})

Deno.test('summarizeEstimate reports run/reused/blocked breakdown', () => {
	const tasks = [
		task({ durationMs: 1000 }),
		task({ key: 'shells/chat:b', name: 'b', durationMs: 2000, reused: true }),
		task({ key: 'shells/chat:c', name: 'c', durationMs: 3000, blocked: true }),
	]
	const summary = summarizeEstimate(tasks, {
		memBudgetBytes: 8000 * MiB,
		cpuBudgetPct: 85,
	})
	assertEquals(summary.runCount, 1)
	assertEquals(summary.reusedCount, 1)
	assertEquals(summary.blockedCount, 1)
})

Deno.test('simulateParallelMakespanMs keeps duplicate suite instances', () => {
	const result = simulateParallelMakespanMs([
		task({ id: 'q1', key: 'same', durationMs: 1000, memMb: 100, cpuPct: 80 }),
		task({ id: 'q2', key: 'same', name: 'same', durationMs: 1000, memMb: 100, cpuPct: 80 }),
	], { memBudgetBytes: 200 * MiB, cpuBudgetPct: 85, speculative: false })
	assertEquals(result.makespanMs, 2000)
})

Deno.test('simulateParallelMakespanMs seeds running leftover at t=0', () => {
	const result = simulateParallelMakespanMs([
		task({
			id: 'run', key: 'a', durationMs: 10_000, elapsedMs: 5000, running: true,
			memMb: 100, cpuPct: 80,
		}),
		task({ id: 'q', key: 'b', name: 'b', durationMs: 1000, memMb: 100, cpuPct: 80 }),
	], { memBudgetBytes: 8000 * MiB, cpuBudgetPct: 85, speculative: false })
	assertEquals(result.makespanMs, 6000)
})

Deno.test('unknown duration does not complete and release dependents', () => {
	const summary = summarizeEstimate([
		task({ key: 'dep', durationMs: null }),
		task({ key: 'down', name: 'down', durationMs: 5000, deps: ['dep'] }),
	], { memBudgetBytes: 8000 * MiB, cpuBudgetPct: 85, speculative: false })
	assertEquals(summary.unknownCount, 1)
	assertEquals(summary.etaMs, null)
})

Deno.test('known independent remaining survives unknown siblings', () => {
	const summary = summarizeEstimate([
		task({ durationMs: null }),
		task({ key: 'shells/chat:b', name: 'b', durationMs: 5000 }),
	], { memBudgetBytes: 8000 * MiB, cpuBudgetPct: 85, speculative: false })
	assertEquals(summary.unknownCount, 1)
	assertEquals(summary.etaMs >= 5000, true)
})

Deno.test('hard-ready remaining does not overlap dependents', () => {
	const result = simulateParallelMakespanMs([
		task({ key: 'server:live', name: 'live', durationMs: 30_000, memMb: 400, cpuPct: 20 }),
		task({
			key: 'shells/chat:ws_rpc',
			name: 'ws_rpc',
			durationMs: 20_000,
			memMb: 400,
			cpuPct: 20,
			deps: ['server:live'],
		}),
	], { memBudgetBytes: 8000 * MiB, cpuBudgetPct: 85, speculative: false })
	assertEquals(result.makespanMs, 50_000)
})

Deno.test('simulateParallelMakespanMs adds module-check then execution', () => {
	const result = simulateParallelMakespanMs([
		task({ durationMs: 1000, moduleCheckMs: 200, memMb: 10, cpuPct: 5 }),
	], { memBudgetBytes: 8000 * MiB, cpuBudgetPct: 85 })
	assertEquals(result.makespanMs, 1200)
})

Deno.test('simulateParallelMakespanMs serializes module-check before execution start', () => {
	const result = simulateParallelMakespanMs([
		task({ durationMs: 1000, moduleCheckMs: 200, memMb: 10, cpuPct: 5 }),
		task({ key: 'shells/chat:b', name: 'b', durationMs: 1000, moduleCheckMs: 200, memMb: 10, cpuPct: 5 }),
	], { memBudgetBytes: 8000 * MiB, cpuBudgetPct: 85 })
	// A: 检查 0-200、执行 200-1200；B 检查从 200 开始、执行从 400 开始 → 1400
	assertEquals(result.makespanMs, 1400)
})
