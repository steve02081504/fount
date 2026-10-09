/* global Deno */
import { assertAlmostEquals, assertEquals } from 'jsr:@std/assert'

import { intervalUnionMs, mergeRunStatistics, summarizeStatistics } from '../../public/shared/statistics.mjs'

Deno.test('parallel tool time is cumulative while wait time counts overlap once', () => {
	const tools = [{ startedAt: 100, finishedAt: 500 }, { startedAt: 200, finishedAt: 700 }, { startedAt: 900, finishedAt: 1000 }]
	const metrics = summarizeStatistics({ runs: [{ tools }] })
	assertEquals(metrics.toolMs, 1000)
	assertEquals(metrics.toolWaitMs, 700)
	assertEquals(intervalUnionMs([{ startedAt: 10, finishedAt: 5 }]), 0)
})

Deno.test('TPS weights output by measured output duration and ignores unknown token counts', () => {
	const calls = [
		{ startedAt: 0, firstOutputAt: 100, finishedAt: 1100, outputTokens: 100 },
		{ startedAt: 2000, firstOutputAt: 2300, finishedAt: 5300, outputTokens: 600 },
		{ startedAt: 6000, finishedAt: 7000, outputTokens: 99 },
		{ startedAt: 8000, firstOutputAt: 8500, finishedAt: 9000 },
	]
	const metrics = summarizeStatistics({ runs: [{ calls }] })
	assertEquals(metrics.steps, 4)
	assertEquals(metrics.tps, 175)
	assertEquals(metrics.ttftMs, 300)
	assertEquals(metrics.ttftCount, 3)
})

Deno.test('cache rate uses reported input weights and exposes incomplete coverage', () => {
	const metrics = summarizeStatistics({}, { calls: [{ inputTokens: 100, cacheReadTokens: 80 }, { inputTokens: 900, cacheReadTokens: 90 }, { inputTokens: 50 }] })
	assertAlmostEquals(metrics.cacheRate, 0.17)
	assertEquals(metrics.cacheIncomplete, true)
	assertEquals(summarizeStatistics({}, { calls: [{ inputTokens: 50 }] }).cacheRate, null)
	assertEquals(summarizeStatistics().ttftMs, null)
	assertEquals(summarizeStatistics().tps, null)
})

Deno.test('replay replaces a run snapshot and retains incurred rounds after message edits', () => {
	const initial = mergeRunStatistics(null, { runId: 'one', calls: [{ callId: 'a' }] })
	const replay = mergeRunStatistics(initial, { runId: 'one', calls: [{ callId: 'a' }, { callId: 'b' }] })
	const next = mergeRunStatistics(replay, { runId: 'two', calls: [] })
	assertEquals(summarizeStatistics(next).rounds, 2)
	assertEquals(summarizeStatistics(next).steps, 2)
	assertEquals(initial.runs[0].calls.length, 1)
})

Deno.test('async task settlement replaces live records and is distinct from launching tools', () => {
	const stats = { runs: [{ tools: [{ startedAt: 1, finishedAt: 2 }], asyncTasks: [{ callId: 'async:a', startedAt: 10, finishedAt: null }] }] }
	const entries = [{ extension: { asyncWork: { callId: 'async:a', startedAt: 10, finishedAt: 2010 } } }, { extension: { asyncAwait: { settled: [{ id: 'a', startedAt: 10, finishedAt: 2010 }] } } }]
	const result = summarizeStatistics(stats, {}, entries)
	assertEquals(result.asyncMs, 2000)
	assertEquals(result.toolMs, 1)
})
