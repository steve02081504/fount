/* global Deno */
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	BASELINE_EMA_CPU,
	BASELINE_EMA_DURATION,
	BASELINE_EMA_MEM,
	nextBaselineCpuPct,
	nextBaselineDurationMs,
	nextBaselineEma,
	nextBaselineMemMb,
} from '../core/baseline.mjs'
import { MiB } from '../core/concurrency.mjs'
import {
	inferDefaultResources,
	parseManifestResources,
	resolveSuiteResources,
	resourcesMemBytes,
	suiteSchedulePriority,
} from '../core/resources.mjs'
import { PlanRunCoordinator } from '../runner/dependency_scheduler.mjs'
import { ResourceRunGate } from '../runner/scheduler.mjs'

import { makeSuite } from './fixtures.mjs'

Deno.test('nextBaselineEma smooths with fixed window N', () => {
	assertEquals(nextBaselineEma(null, 100, 4), 100)
	assertEquals(nextBaselineEma(100, 60, 4), (100 * 4 + 60) / 5)
	assertEquals(nextBaselineEma(100, null, 4), 100)
})

Deno.test('metric-specific EMA uses different N', () => {
	assertEquals(BASELINE_EMA_CPU, 8)
	assertEquals(BASELINE_EMA_MEM, 4)
	assertEquals(BASELINE_EMA_DURATION, 2)
	assertEquals(nextBaselineMemMb(1200, 800), (1200 * BASELINE_EMA_MEM + 800) / (BASELINE_EMA_MEM + 1))
	assertEquals(nextBaselineDurationMs(40_000, 50_000), (40_000 * 2 + 50_000) / 3)
	assertEquals(nextBaselineCpuPct(50, 80), (50 * 8 + 80) / 9)
})

Deno.test('parseManifestResources accepts partial fields', () => {
	assertEquals(parseManifestResources({ cpuPct: 42.7 }), { cpuPct: 42.7 })
	assertEquals(parseManifestResources({ cpuPct: 150 }), { cpuPct: 100 })
})

Deno.test('inferDefaultResources maps fed profiles', () => {
	assertEquals(inferDefaultResources(makeSuite('shells/chat', 'fed_core')), { memMb: 1400, cpuPct: 35 })
	assertEquals(inferDefaultResources(makeSuite('shells/chat', 'fed_ban')), { memMb: 1600, cpuPct: 45 })
})

Deno.test('resolveSuiteResources merges manifest, defaults, and sampled baseline', () => {
	const suite = makeSuite('shells/chat', 'fed_core', { resources: { memMb: 1000 } })
	assertEquals(resolveSuiteResources(suite, undefined), { memMb: 1400, cpuPct: 35 })
	assertEquals(
		resolveSuiteResources(suite, { baselineMemMb: 2200, baselineCpuPct: 55 }),
		{ memMb: 2200, cpuPct: 55 },
	)
	// 有采样时不再被命名默认顶高；亚 1% CPU 基线当噪声忽略
	assertEquals(
		resolveSuiteResources(suite, { baselineMemMb: 68, baselineCpuPct: 8e-6 }),
		{ memMb: 1000, cpuPct: 35 },
	)
})

Deno.test('ResourceRunGate never idles when a waiter exceeds budget', async () => {
	// 不变量：有活干时机器不能空转——预算不够装也要开工。
	const gate = new ResourceRunGate(500 * MiB)
	const huge = makeSuite('shells/chat', 'integration', { resources: { memMb: 1800, cpuPct: 25 } })
	const release = await Promise.race([
		gate.acquire(huge),
		new Promise((_, reject) => setTimeout(() => reject(new Error('gate left machine idle')), 200)),
	])
	assertEquals(gate.usedMemBytes, 1800 * MiB)
	release()
})

Deno.test('suiteSchedulePriority prefers larger footprint', () => {
	const fed = makeSuite('shells/chat', 'fed_core')
	const pure = makeSuite('shells/chat', 'pure')
	assert(suiteSchedulePriority(fed, undefined) > suiteSchedulePriority(pure, undefined))
})

Deno.test('ResourceRunGate heavy suite runs exclusively', async () => {
	const gate = new ResourceRunGate(8000 * MiB)
	const heavy = makeSuite('shells/chat', 'fed_ban', { heavy: true })
	const light = makeSuite('shells/chat', 'pure', { resources: { memMb: 100, cpuPct: 5 } })

	const releaseHeavy = await gate.acquire(heavy)
	assert(gate.exclusiveRunning)

	const lightPromise = gate.acquire(light)
	await Promise.resolve()
	assertEquals(gate.exclusiveRunning, true)

	releaseHeavy()
	const releaseLight = await lightPromise
	assertEquals(gate.exclusiveRunning, false)
	releaseLight()
})

Deno.test('ResourceRunGate packs by mem and cpu pct', async () => {
	const gate = new ResourceRunGate(3000 * MiB)
	const a = makeSuite('shells/chat', 'fed_core')
	const b = makeSuite('shells/chat', 'fed_dm')
	const c = makeSuite('shells/chat', 'fed_ban')

	const releaseA = await gate.acquire(a)
	const releaseB = await gate.acquire(b)
	assertEquals(gate.usedMemBytes, 2800 * MiB)

	const waitC = gate.acquire(c)
	let cReady = false
	waitC.then(() => { cReady = true })
	await Promise.resolve()
	assertEquals(cReady, false)

	releaseA()
	await waitC
	assertEquals(cReady, true)

	releaseB()
	await await gate.acquire(makeSuite('shells/chat', 'pure', { resources: { memMb: 100, cpuPct: 5 } }))
	assertEquals(resourcesMemBytes({ memMb: 100, cpuPct: 5 }), 100 * MiB)
})

Deno.test('ResourceRunGate blocks when cpu budget exhausted', async () => {
	const gate = new ResourceRunGate(8000 * MiB)
	const hot = makeSuite('shells/chat', 'fed_core', { resources: { memMb: 200, cpuPct: 50 } })
	const warm = makeSuite('shells/chat', 'fed_core', { resources: { memMb: 200, cpuPct: 40 } })

	const releaseHot = await gate.acquire(hot)
	assertEquals(gate.usedCpuPct, 50)

	const waitWarm = gate.acquire(warm)
	let warmReady = false
	waitWarm.then(() => { warmReady = true })
	await Promise.resolve()
	assertEquals(warmReady, false)

	releaseHot()
	await waitWarm
	assert(warmReady)
})

Deno.test('ResourceRunGate fill-gap packs mem-heavy with cpu-heavy in parallel', async () => {
	const gate = new ResourceRunGate(2200 * MiB)
	const memHeavy = makeSuite('testkit', 'custom_mem', { resources: { memMb: 1800, cpuPct: 10 } })
	const cpuHeavy = makeSuite('testkit', 'custom_cpu', { resources: { memMb: 200, cpuPct: 60 } })

	const releaseMem = await gate.acquire(memHeavy)
	assertEquals(gate.usedMemBytes, 1800 * MiB)

	const releaseCpu = await gate.acquire(cpuHeavy)
	assertEquals(gate.usedCpuPct, 75)
	assertEquals(gate.usedMemBytes, 2200 * MiB)

	releaseMem()
	releaseCpu()
})

Deno.test('ResourceRunGate serial mode runs one light suite at a time', async () => {
	const gate = new ResourceRunGate(8000 * MiB, () => undefined, { serial: true })
	const a = makeSuite('shells/chat', 'pure', { resources: { memMb: 100, cpuPct: 5 } })
	const b = makeSuite('shells/chat', 'fed_core', { resources: { memMb: 100, cpuPct: 5 } })

	const releaseA = await gate.acquire(a)
	const waitB = gate.acquire(b)
	let bReady = false
	waitB.then(() => { bReady = true })
	await Promise.resolve()
	assertEquals(bReady, false)

	releaseA()
	await waitB
	assert(bReady)
})

Deno.test('ResourceRunGate serial mode admits waiters FIFO, not by footprint', async () => {
	// 队首体量小、队尾体量大：串行必须按插入顺序（报告序）放行，而非资源择优。
	const gate = new ResourceRunGate(8000 * MiB, () => undefined, { serial: true })
	const small = makeSuite('shells/chat', 'pure', { resources: { memMb: 100, cpuPct: 5 } })
	const big = makeSuite('shells/chat', 'fed_core', { resources: { memMb: 1800, cpuPct: 90 } })

	/** @type {string[]} */
	const admitted = []
	const waitSmall = gate.acquire(small).then(release => { admitted.push('small'); return release })
	const waitBig = gate.acquire(big).then(release => { admitted.push('big'); return release })

	const releaseSmall = await waitSmall
	assertEquals(admitted, ['small'])
	releaseSmall()
	await waitBig
	assertEquals(admitted, ['small', 'big'])
})

Deno.test('PlanRunCoordinator throws on dependency deadlock', async () => {
	const a = makeSuite('shells/chat', 'a', { dependsOn: ['b'] })
	const b = makeSuite('shells/chat', 'b', { dependsOn: ['a'] })
	a.dependencies = [{ manifestId: 'shells/chat', name: 'b' }]
	b.dependencies = [{ manifestId: 'shells/chat', name: 'a' }]
	const gate = new ResourceRunGate(8000 * MiB)
	const coordinator = new PlanRunCoordinator({
		slots: [
			{ key: 'shells/chat:a', suite: a, action: 'run', goal: true },
			{ key: 'shells/chat:b', suite: b, action: 'run', goal: true },
		],
		state: { suites: {} },
		gate,
	})
	let threw = false
	try {
		await coordinator.runAll(async () => ({ passed: true }))
	}
	catch (error) {
		threw = true
		assert(String(error.message).includes('scheduler deadlock'))
	}
	assert(threw)
})

Deno.test('PlanRunCoordinator speculatively overlaps dependent while dep runs', async () => {
	const root = makeSuite('server', 'live', { resources: { memMb: 200, cpuPct: 10 } })
	const child = makeSuite('shells/chat', 'ws_rpc', {
		dependsOn: ['server:live'],
		resources: { memMb: 200, cpuPct: 10 },
	})
	const gate = new ResourceRunGate(8000 * MiB)
	const coordinator = new PlanRunCoordinator({
		slots: [
			{ key: 'server:live', suite: root, action: 'run', goal: true },
			{ key: 'shells/chat:ws_rpc', suite: child, action: 'run', goal: true },
		],
		state: { suites: {} },
		gate,
	})

	/** @type {string[]} */
	const started = []
	/** @type {(() => void) | undefined} */
	let releaseRoot
	const rootHold = new Promise(resolve => { releaseRoot = resolve })

	const done = coordinator.runAll(async (slot, ctx) => {
		started.push(`${slot.key}:${ctx.speculative ? 'spec' : 'hard'}`)
		if (slot.key === 'server:live') {
			await rootHold
			return { passed: true }
		}
		const gateResult = await ctx.awaitCommitGate()
		assertEquals(gateResult.ok, true)
		return { passed: true }
	})

	for (let i = 0; i < 50 && started.length < 2; i++)
		await new Promise(resolve => setTimeout(resolve, 1))
	assert(started.includes('server:live:hard'))
	assert(started.includes('shells/chat:ws_rpc:spec'))
	assertEquals(started.indexOf('server:live:hard') < started.indexOf('shells/chat:ws_rpc:spec'), true)
	releaseRoot()
	await done
})

Deno.test('PlanRunCoordinator discards speculative result when dependency fails', async () => {
	const root = makeSuite('server', 'live', { resources: { memMb: 200, cpuPct: 10 } })
	const child = makeSuite('shells/cabinet', 'integration', {
		dependsOn: ['server:live'],
		resources: { memMb: 200, cpuPct: 10 },
	})
	const gate = new ResourceRunGate(8000 * MiB)
	const coordinator = new PlanRunCoordinator({
		slots: [
			{ key: 'server:live', suite: root, action: 'run', goal: true },
			{ key: 'shells/cabinet:integration', suite: child, action: 'run', goal: true },
		],
		state: { suites: {} },
		gate,
	})

	/** @type {Record<string, { speculative: boolean, commitOk?: boolean }>} */
	const outcomes = {}
	/** @type {(() => void) | undefined} */
	let releaseRoot
	const rootHold = new Promise(resolve => { releaseRoot = resolve })
	let childWaiting = false

	const done = coordinator.runAll(async (slot, ctx) => {
		if (slot.key === 'server:live') {
			outcomes[slot.key] = { speculative: ctx.speculative }
			await rootHold
			return { passed: false }
		}
		childWaiting = true
		const gateResult = await ctx.awaitCommitGate()
		outcomes[slot.key] = { speculative: ctx.speculative, commitOk: gateResult.ok }
		return { passed: false }
	})

	for (let i = 0; i < 100 && !childWaiting; i++)
		await new Promise(resolve => setTimeout(resolve, 1))
	assert(childWaiting)
	releaseRoot()
	await done

	assertEquals(outcomes['server:live']?.speculative, false)
	assertEquals(outcomes['shells/cabinet:integration']?.speculative, true)
	assertEquals(outcomes['shells/cabinet:integration']?.commitOk, false)
})

Deno.test('PlanRunCoordinator blocks dependent without run when dep already failed', async () => {
	const root = makeSuite('server', 'live', { resources: { memMb: 2000, cpuPct: 80 } })
	const child = makeSuite('shells/chat', 'ws_rpc', {
		dependsOn: ['server:live'],
		resources: { memMb: 2000, cpuPct: 80 },
	})
	// 内存只够一个：子无法乐观并行，等根失败后走 discardWithoutRun
	const gate = new ResourceRunGate(2200 * MiB)
	const coordinator = new PlanRunCoordinator({
		slots: [
			{ key: 'server:live', suite: root, action: 'run', goal: true },
			{ key: 'shells/chat:ws_rpc', suite: child, action: 'run', goal: true },
		],
		state: { suites: {} },
		gate,
	})

	/** @type {string[]} */
	const events = []
	await coordinator.runAll(async (slot, ctx) => {
		if (ctx.discardWithoutRun) {
			events.push(`block:${slot.key}`)
			return { passed: false }
		}
		events.push(`run:${slot.key}`)
		return { passed: slot.key !== 'server:live' }
	})

	assertEquals(events, ['run:server:live', 'block:shells/chat:ws_rpc'])
})

Deno.test('PlanRunCoordinator prefers nearer cheaper speculative over far heavy', async () => {
	// 根 + 任一子都装得下，但装不下两个子：排序决定先投机谁
	// server:live 默认 500MB；near/far 默认 400MB → 预算 1000 只够根+一子
	const gate = new ResourceRunGate(1000 * MiB)
	const root = makeSuite('server', 'live', { resources: { memMb: 200, cpuPct: 10 } })
	const near = makeSuite('server', 'near_child', {
		dependsOn: ['server:live'],
		resources: { memMb: 200, cpuPct: 10 },
	})
	const far = makeSuite('shells/chat', 'far_child', {
		dependsOn: ['server:live'],
		resources: { memMb: 200, cpuPct: 10 },
	})
	const coordinator = new PlanRunCoordinator({
		slots: [
			{ key: 'server:live', suite: root, action: 'run', goal: true },
			{ key: 'shells/chat:far_child', suite: far, action: 'run', goal: true },
			{ key: 'server:near_child', suite: near, action: 'run', goal: true },
		],
		state: {
			suites: {
				'server:near_child': { baselineDurationMs: 5_000 },
				'shells/chat:far_child': { baselineDurationMs: 120_000 },
			},
		},
		gate,
	})

	/** @type {string[]} */
	const speculativeStarted = []
	/** @type {(() => void) | undefined} */
	let releaseRoot
	const rootHold = new Promise(resolve => { releaseRoot = resolve })

	const done = coordinator.runAll(async (slot, ctx) => {
		if (slot.key === 'server:live') {
			await rootHold
			return { passed: true }
		}
		if (ctx.speculative) speculativeStarted.push(slot.key)
		await ctx.awaitCommitGate()
		return { passed: true }
	})

	for (let i = 0; i < 100 && !speculativeStarted.length; i++)
		await new Promise(resolve => setTimeout(resolve, 1))
	assertEquals(speculativeStarted[0], 'server:near_child')
	releaseRoot()
	await done
})

Deno.test('PlanRunCoordinator does not stack on speculative parent until promoted', async () => {
	const a = makeSuite('server', 'a', { resources: { memMb: 100, cpuPct: 5 } })
	const b = makeSuite('server', 'b', {
		dependsOn: ['server:a'],
		resources: { memMb: 100, cpuPct: 5 },
	})
	const c = makeSuite('server', 'c', {
		dependsOn: ['server:b'],
		resources: { memMb: 100, cpuPct: 5 },
	})
	const gate = new ResourceRunGate(8000 * MiB)
	const coordinator = new PlanRunCoordinator({
		slots: [
			{ key: 'server:a', suite: a, action: 'run', goal: true },
			{ key: 'server:b', suite: b, action: 'run', goal: true },
			{ key: 'server:c', suite: c, action: 'run', goal: true },
		],
		state: { suites: {} },
		gate,
	})

	/** @type {string[]} */
	const speculativeKeys = []
	/** @type {(() => void) | undefined} */
	let releaseA
	const aHold = new Promise(resolve => { releaseA = resolve })
	/** @type {(() => void) | undefined} */
	let releaseB
	const bHold = new Promise(resolve => { releaseB = resolve })

	const done = coordinator.runAll(async (slot, ctx) => {
		if (ctx.speculative) speculativeKeys.push(slot.key)
		if (slot.key === 'server:a') {
			await aHold
			return { passed: true }
		}
		if (slot.key === 'server:b') {
			await bHold
			const gateResult = await ctx.awaitCommitGate()
			assertEquals(gateResult.ok, true)
			return { passed: true }
		}
		await ctx.awaitCommitGate()
		return { passed: true }
	})

	for (let i = 0; i < 100 && !speculativeKeys.includes('server:b'); i++)
		await new Promise(resolve => setTimeout(resolve, 1))
	// A 硬跑、B 仍投机：C 不得叠
	assertEquals(speculativeKeys.includes('server:c'), false)
	releaseA()
	// A 通过 → B 升级硬锚 → C 可投机挂靠 B 剩余
	for (let i = 0; i < 100 && !speculativeKeys.includes('server:c'); i++)
		await new Promise(resolve => setTimeout(resolve, 1))
	assert(speculativeKeys.includes('server:c'))
	releaseB()
	await done
})

Deno.test('PlanRunCoordinator aborts speculative signal when dependency fails', async () => {
	const root = makeSuite('server', 'live', { resources: { memMb: 200, cpuPct: 10 } })
	const child = makeSuite('shells/chat', 'ws_rpc', {
		dependsOn: ['server:live'],
		resources: { memMb: 200, cpuPct: 10 },
	})
	const gate = new ResourceRunGate(8000 * MiB)
	const coordinator = new PlanRunCoordinator({
		slots: [
			{ key: 'server:live', suite: root, action: 'run', goal: true },
			{ key: 'shells/chat:ws_rpc', suite: child, action: 'run', goal: true },
		],
		state: { suites: {} },
		gate,
	})

	/** @type {(() => void) | undefined} */
	let releaseRoot
	const rootHold = new Promise(resolve => { releaseRoot = resolve })
	/** @type {AbortSignal | undefined} */
	let childSignal
	let childSawAbort = false

	const done = coordinator.runAll(async (slot, ctx) => {
		if (slot.key === 'server:live') {
			await rootHold
			return { passed: false }
		}
		childSignal = ctx.signal
		assert(childSignal)
		const aborted = new Promise(resolve => {
			childSignal.addEventListener('abort', () => {
				childSawAbort = true
				resolve(undefined)
			}, { once: true })
		})
		await aborted
		const gateResult = await ctx.awaitCommitGate()
		assertEquals(gateResult.ok, false)
		return { passed: false }
	})

	for (let i = 0; i < 100 && !childSignal; i++)
		await new Promise(resolve => setTimeout(resolve, 1))
	assert(childSignal)
	assertEquals(childSignal.aborted, false)
	releaseRoot()
	await done
	assert(childSawAbort)
})

Deno.test('PlanRunCoordinator speculates into spare while other hard suite runs', async () => {
	// 独立硬跑占一部分预算；依赖链旁仍有余量 → 子应投机
	const root = makeSuite('server', 'live', { resources: { memMb: 200, cpuPct: 10 } })
	const other = makeSuite('server', 'other', { resources: { memMb: 200, cpuPct: 10 } })
	const child = makeSuite('shells/chat', 'ws_rpc', {
		dependsOn: ['server:live'],
		resources: { memMb: 200, cpuPct: 10 },
	})
	const gate = new ResourceRunGate(8000 * MiB)
	const coordinator = new PlanRunCoordinator({
		slots: [
			{ key: 'server:live', suite: root, action: 'run', goal: true },
			{ key: 'server:other', suite: other, action: 'run', goal: true },
			{ key: 'shells/chat:ws_rpc', suite: child, action: 'run', goal: true },
		],
		state: { suites: {} },
		gate,
	})

	/** @type {string[]} */
	const started = []
	/** @type {(() => void) | undefined} */
	let releaseRoot
	const rootHold = new Promise(resolve => { releaseRoot = resolve })
	/** @type {(() => void) | undefined} */
	let releaseOther
	const otherHold = new Promise(resolve => { releaseOther = resolve })

	const done = coordinator.runAll(async (slot, ctx) => {
		started.push(`${slot.key}:${ctx.speculative ? 'spec' : 'hard'}`)
		if (slot.key === 'server:live') {
			await rootHold
			return { passed: true }
		}
		if (slot.key === 'server:other') {
			await otherHold
			return { passed: true }
		}
		await ctx.awaitCommitGate()
		return { passed: true }
	})

	for (let i = 0; i < 100 && started.length < 3; i++)
		await new Promise(resolve => setTimeout(resolve, 1))
	assert(started.includes('server:live:hard'))
	assert(started.includes('server:other:hard'))
	assert(started.includes('shells/chat:ws_rpc:spec'))
	releaseRoot()
	releaseOther()
	await done
})

Deno.test('ResourceRunGate tryAcquire returns null when over budget', () => {
	const gate = new ResourceRunGate(1000 * MiB)
	const held = makeSuite('testkit', 'hold_mem', { resources: { memMb: 800, cpuPct: 25 } })
	const extra = makeSuite('testkit', 'extra_mem', { resources: { memMb: 400, cpuPct: 5 } })
	const releaseHeld = gate.tryAcquire(held)
	assert(releaseHeld)
	assertEquals(gate.tryAcquire(extra), null)
	releaseHeld()
	const releaseExtra = gate.tryAcquire(extra)
	assert(releaseExtra)
	releaseExtra()
})
