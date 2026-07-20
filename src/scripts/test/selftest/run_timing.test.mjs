/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	formatExpectedDuration,
	formatParallelRatePct,
	parallelRatePct,
	sumNonReusedDurationMs,
	summarizeRunTiming,
	wallClockMs,
} from '../core/run_timing.mjs'

Deno.test('sumNonReusedDurationMs skips reused slots', () => {
	assertEquals(sumNonReusedDurationMs([
		{ durationMs: 1000, reused: false },
		{ durationMs: 2000, reused: true },
		{ durationMs: 500 },
	]), 1500)
})

Deno.test('wallClockMs uses finishedAt or now', () => {
	const startedAt = '2026-01-01T00:00:00.000Z'
	assertEquals(wallClockMs({ startedAt, finishedAt: '2026-01-01T00:00:10.000Z' }), 10_000)
	assertEquals(wallClockMs({ startedAt }, Date.parse('2026-01-01T00:00:05.000Z')), 5000)
})

Deno.test('parallelRatePct is suite sum over wall clock minus 100%', () => {
	assertEquals(parallelRatePct(3000, 1000), 200)
	assertEquals(parallelRatePct(1000, 1000), 0)
	assertEquals(parallelRatePct(900, 1000), -10)
	assertEquals(parallelRatePct(1000, 0), null)
	// 全复用/全阻塞（无真跑耗时）时并行率无意义。
	assertEquals(parallelRatePct(0, 1000), null)
})

Deno.test('formatParallelRatePct rounds to whole percent', () => {
	assertEquals(formatParallelRatePct(198.6), '199%')
	assertEquals(formatParallelRatePct(-1.4), '-1%')
	assertEquals(formatParallelRatePct(null), '—')
})

Deno.test('formatExpectedDuration returns null without baseline', () => {
	assertEquals(formatExpectedDuration(null), null)
	assertEquals(formatExpectedDuration(0), null)
})

Deno.test('summarizeRunTiming aggregates report fields', () => {
	const completed = [
		{ durationMs: 2000, reused: false },
		{ durationMs: 8000, reused: true },
	]
	const summary = {
		startedAt: '2026-01-01T00:00:00.000Z',
		finishedAt: '2026-01-01T00:00:01.000Z',
	}
	assertEquals(summarizeRunTiming(completed, summary), {
		suiteSumMs: 2000,
		wallClockMs: 1000,
		parallelRatePct: 100,
	})
})
