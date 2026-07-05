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
		...overrides,
	}
}

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

Deno.test('inferDefaultResources maps fed and sim profiles', () => {
	assertEquals(inferDefaultResources(stubSuite({ name: 'fed_core' })), { memMb: 1400, cpuPct: 35 })
	assertEquals(inferDefaultResources(stubSuite({ manifestId: 'p2p', name: 'sim' })), { memMb: 800, cpuPct: 92 })
})

Deno.test('resolveSuiteResources merges manifest, defaults, and sampled baseline', () => {
	const suite = stubSuite({ resources: { memMb: 1000 } })
	assertEquals(resolveSuiteResources(suite, undefined), { memMb: 1400, cpuPct: 35 })
	assertEquals(
		resolveSuiteResources(suite, { baselineMemMb: 2200, baselineCpuPct: 55 }),
		{ memMb: 2200, cpuPct: 55 },
	)
})

Deno.test('suiteSchedulePriority prefers larger footprint', () => {
	const fed = stubSuite({ name: 'fed_core' })
	const pure = stubSuite({ name: 'pure' })
	assert(suiteSchedulePriority(fed, undefined) > suiteSchedulePriority(pure, undefined))
})

Deno.test('ResourceRunGate heavy suite runs exclusively', async () => {
	const gate = new ResourceRunGate(8000 * MiB)
	const heavy = stubSuite({ manifestId: 'p2p', name: 'sim', heavy: true })
	const light = stubSuite({ name: 'pure', resources: { memMb: 100, cpuPct: 5 } })

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
	const a = stubSuite({ name: 'fed_core' })
	const b = stubSuite({ name: 'fed_dm' })
	const c = stubSuite({ name: 'fed_ban' })

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
	await await gate.acquire(stubSuite({ name: 'pure', resources: { memMb: 100, cpuPct: 5 } }))
	assertEquals(resourcesMemBytes({ memMb: 100, cpuPct: 5 }), 100 * MiB)
})

Deno.test('ResourceRunGate blocks when cpu budget exhausted', async () => {
	const gate = new ResourceRunGate(8000 * MiB)
	const hot = stubSuite({ resources: { memMb: 200, cpuPct: 50 } })
	const warm = stubSuite({ name: 'fed_core', resources: { memMb: 200, cpuPct: 40 } })

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
	const memHeavy = stubSuite({
		name: 'custom_mem',
		manifestId: 'testkit',
		resources: { memMb: 1800, cpuPct: 10 },
	})
	const cpuHeavy = stubSuite({
		name: 'custom_cpu',
		manifestId: 'testkit',
		resources: { memMb: 200, cpuPct: 60 },
	})

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
	const a = stubSuite({ name: 'pure', resources: { memMb: 100, cpuPct: 5 } })
	const b = stubSuite({ name: 'fed_core', resources: { memMb: 100, cpuPct: 5 } })

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
