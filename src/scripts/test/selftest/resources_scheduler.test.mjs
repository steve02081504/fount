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
