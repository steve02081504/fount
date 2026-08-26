/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { MiB } from '../core/concurrency.mjs'
import { buildTimeline, projectConsumer } from '../kernel/schedule.mjs'
import { shouldDisplayScheduleChange } from '../kernel/schedule_event.mjs'

/**
 * @param {object} spec 字段
 * @param {string} spec.key suite 键
 * @param {number | null} spec.durationMs 耗时（毫秒）
 * @param {number} [spec.elapsedMs] 已运行毫秒
 * @param {boolean} [spec.running] 在跑
 * @param {number} [spec.memMb] 内存（MB）
 * @param {number} [spec.cpuPct] CPU（%）
 * @param {boolean} [spec.heavy] heavy
 * @param {string[]} [spec.deps] 依赖键
 * @param {string | null} [spec.jobId] 归属 job
 * @param {'cli' | 'fs'} [spec.source] 来源
 * @param {boolean} [spec.blocked] 阻塞
 * @param {boolean} [spec.reused] 复用
 * @param {string} [spec.id] 实例 id
 * @param {number} [spec.moduleCheckMs] 模组检查互斥时长
 * @returns {import('../kernel/schedule.mjs').ScheduleTask} 任务
 */
function task({ key, durationMs, elapsedMs = 0, running = false, memMb = 400, cpuPct = 15, heavy = false, deps = [], jobId = null, source = 'cli', blocked = false, reused = false, id, moduleCheckMs = 0 }) {
	return {
		id: id ?? key,
		key,
		durationMs,
		elapsedMs,
		running,
		reused,
		blocked,
		memMb,
		cpuPct,
		heavy,
		deps,
		jobId,
		source,
		moduleCheckMs,
	}
}

/** 宽松预算：允许任意 light 并行。 */
const ROOMY = { memBudgetBytes: 64 * 1024 * MiB, cpuBudgetPct: 100 }

Deno.test('heavy suites run exclusively (serial)', () => {
	const { slots, makespanMs } = buildTimeline([
		task({ key: 'heavy_a', durationMs: 1000, heavy: true }),
		task({ key: 'heavy_b', durationMs: 1000, heavy: true }),
	], ROOMY)
	assertEquals(makespanMs, 2000)
	const heavyA = slots.find(s => s.key === 'heavy_a')
	const heavyB = slots.find(s => s.key === 'heavy_b')
	assertEquals(heavyA.endAt, 1000)
	assertEquals(heavyB.startAt, 1000)
})

Deno.test('independent light suites pack in parallel within budget', () => {
	const { makespanMs } = buildTimeline([
		task({ key: 'a', durationMs: 1000, memMb: 200, cpuPct: 50 }),
		task({ key: 'b', durationMs: 1000, memMb: 200, cpuPct: 50 }),
	], ROOMY)
	assertEquals(makespanMs, 1000)
})

Deno.test('light suites exceed CPU budget and serialize', () => {
	const { makespanMs } = buildTimeline([
		task({ key: 'a', durationMs: 1000, memMb: 200, cpuPct: 90 }),
		task({ key: 'b', durationMs: 1000, memMb: 200, cpuPct: 90 }),
	], ROOMY)
	assertEquals(makespanMs, 2000)
})

Deno.test('dependency chain delays downstream to after upstream ends', () => {
	const { slots, makespanMs } = buildTimeline([
		task({ key: 'upstream', durationMs: 1000 }),
		task({ key: 'downstream', durationMs: 1000, deps: ['upstream'] }),
	], ROOMY)
	assertEquals(makespanMs, 2000)
	const upstreamSuite = slots.find(s => s.key === 'upstream')
	const downstreamSuite = slots.find(s => s.key === 'downstream')
	assertEquals(downstreamSuite.startAt >= upstreamSuite.endAt, true)
})

Deno.test('running anchor subtracts elapsed from remaining', () => {
	const { makespanMs } = buildTimeline([
		task({ key: 'a', durationMs: 10_000, elapsedMs: 4000, running: true, heavy: true }),
		task({ key: 'b', durationMs: 1000, heavy: true }),
	], ROOMY)
	assertEquals(makespanMs, 7000)
})

Deno.test('blocked/reused tasks complete instantly and do not extend makespan', () => {
	const { makespanMs, slots } = buildTimeline([
		task({ key: 'a', durationMs: 1000, heavy: true }),
		task({ key: 'gone', durationMs: 50_000, blocked: true }),
		task({ key: 'kept', durationMs: 500, reused: true }),
	], ROOMY)
	assertEquals(makespanMs, 1000)
	assertEquals(slots.find(s => s.key === 'gone').endAt, 0)
	assertEquals(slots.find(s => s.key === 'kept').endAt, 0)
})

Deno.test('consumer projection: watch sees all, job sees only its own', () => {
	const tasks = [
		task({ key: 'a', durationMs: 1000, jobId: 'j1' }),
		task({ key: 'b', durationMs: 2000, jobId: 'j2' }),
	]
	const { slots } = buildTimeline(tasks, ROOMY)
	const watch = projectConsumer(slots, { watch: true })
	assertEquals(watch.running.length, 0)
	assertEquals(watch.lastCompletionAt, 2000)
	const job1 = projectConsumer(slots, { watch: false, jobId: 'j1' })
	assertEquals(job1.lastCompletionAt, 1000)
	const job2 = projectConsumer(slots, { watch: false, jobId: 'j2' })
	assertEquals(job2.lastCompletionAt, 2000)
})

Deno.test('consumer projection exposes running items with remaining', () => {
	const { slots } = buildTimeline([
		task({ key: 'a', durationMs: 10_000, elapsedMs: 3000, running: true, jobId: 'j1' }),
	], ROOMY)
	const job1 = projectConsumer(slots, { watch: false, jobId: 'j1' })
	assertEquals(job1.running.length, 1)
	assertEquals(job1.running[0].key, 'a')
	assertEquals(job1.running[0].endAt, 7000)
})

Deno.test('many light suites with zero module-check mean pack fully in parallel', () => {
	// 低 CPU 占用让 31 个套件全部并行；无模块检查时 makespan ≈ 单套件时长
	const suites = Array.from({ length: 31 }, (_, i) =>
		task({ key: `shells/chat:s${i}`, durationMs: 136_000, memMb: 200, cpuPct: 1 }))
	const { makespanMs } = buildTimeline(suites, ROOMY)
	assertEquals(makespanMs, 136_000)
})

Deno.test('module-check mean serializes the spawn window across suites', () => {
	// 同批套件，但每个 spawn 前要串行占用 40s 模块检查互斥窗口 → makespan 大幅拉长
	const suites = Array.from({ length: 31 }, (_, i) =>
		task({ key: `shells/chat:s${i}`, durationMs: 136_000, moduleCheckMs: 40_000, memMb: 200, cpuPct: 1 }))
	const { makespanMs } = buildTimeline(suites, ROOMY)
	assertEquals(makespanMs, 31 * 40_000 + 136_000)
})

Deno.test('module-check mean does not double-count the spawn window for running tasks', () => {
	// 一个正在跑且已完成模块检查的任务，moduleCheckMs 应为 0，不再推进互斥窗口；
	// 因此 b 的模块检查可从 t=0 立即开始，b.startAt = 0，make span = 40000 + 1000
	const { slots, makespanMs } = buildTimeline([
		task({ key: 'a', durationMs: 1000, moduleCheckMs: 0, running: true }),
		task({ key: 'b', durationMs: 1000, moduleCheckMs: 40_000 }),
	], ROOMY)
	assertEquals(makespanMs, 41_000)
	assertEquals(slots.find(s => s.key === 'b').startAt, 0)
})

Deno.test('running task endAt includes its remaining module-check time', () => {
	// 正在跑且仍持有检查租约的任务：完成时刻 = 剩余执行 + 剩余检查，且互斥窗持续到剩余检查结束。
	const { slots, makespanMs } = buildTimeline([
		task({ key: 'a', durationMs: 10_000, elapsedMs: 3000, moduleCheckMs: 2000, running: true }),
	], ROOMY)
	assertEquals(slots.find(s => s.key === 'a').endAt, 9000)
	assertEquals(makespanMs, 9000)
})

Deno.test('queued task startAt reflects module-check spawn delay, not admission time', () => {
	// a 的模块检查占用 0-200；b 的 spawnAt 只能从 200 开始，而不是被接纳的 0
	const { slots } = buildTimeline([
		task({ key: 'a', durationMs: 1000, moduleCheckMs: 200, memMb: 10, cpuPct: 5 }),
		task({ key: 'b', durationMs: 1000, moduleCheckMs: 200, memMb: 10, cpuPct: 5 }),
	], ROOMY)
	const b = slots.find(s => s.key === 'b')
	assertEquals(b.startAt, 200)
	assertEquals(b.endAt, 1400)
})

Deno.test('shouldDisplayScheduleChange only above 5%', () => {
	assertEquals(shouldDisplayScheduleChange(null, 100_000), true)
	assertEquals(shouldDisplayScheduleChange(100_000, null), true)
	assertEquals(shouldDisplayScheduleChange(100_000, 104_000), false)
	assertEquals(shouldDisplayScheduleChange(100_000, 106_000), true)
	assertEquals(shouldDisplayScheduleChange(100_000, 97_000), false)
	assertEquals(shouldDisplayScheduleChange(100_000, 90_000), true)
})
