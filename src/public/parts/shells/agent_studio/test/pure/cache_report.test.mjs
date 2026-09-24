/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { buildCacheReport } from '../../src/cache_report.mjs'

Deno.test('cache report computes per-request reuse against the previous request', () => {
	const report = buildCacheReport([
		{ id: 'g1', startedAt: 1, requests: [{ index: 1, systemPrompt: 'sys', messages: [{ role: 'user', content: 'hello' }] }] },
		{ id: 'g2', startedAt: 2, requests: [{ index: 1, systemPrompt: 'sys', messages: [{ role: 'user', content: 'hello!' }] }] },
	])
	assertEquals(report.generations[0].requests[0], { index: 1, rate: null, compressed: false })
	assertEquals(report.generations[1].requests[0].rate > 0.6, true)
	assertEquals(report.minNonCompressedRate > 0.6, true)
	assertEquals(report.below, false)
})

Deno.test('cache report flags requests below the threshold', () => {
	const previous = { systemPrompt: 'X'.repeat(200), messages: [{ role: 'user', content: 'M'.repeat(200) }] }
	const current = { systemPrompt: 'Y'.repeat(20), messages: [{ role: 'user', content: 'N'.repeat(400) }] }
	const report = buildCacheReport(
		[
			{ id: 'g1', startedAt: 1, requests: [previous] },
			{ id: 'g2', startedAt: 2, requests: [current] },
		],
		{ conversationId: 'code-abc', threshold: 0.729 },
	)
	assertEquals(report.conversationId, 'code-abc')
	assertEquals(report.minNonCompressedRate < 0.729, true)
	assertEquals(report.below, true)
})

Deno.test('cache report excludes compression rounds and their successor', () => {
	const report = buildCacheReport([
		{ id: 'g1', startedAt: 1, requests: [{ index: 1, systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }] }] },
		{
			id: 'g2', startedAt: 2, requests: [
				{ index: 1, systemPrompt: 'sys', messages: [{ type: 'summary', role: 'system', content: 'summary' }] },
				{ index: 2, systemPrompt: 'sys', messages: [{ role: 'user', content: 'after' }] },
			],
		},
	])
	assertEquals(report.generations[1].requests[0], { index: 1, rate: null, compressed: true })
	assertEquals(report.generations[1].requests[1], { index: 2, rate: null, compressed: false })
	// 唯一可比的轮是 g1 的第 1 轮（无前置，rate 为 null）；压缩轮不计入最低命中率
	assertEquals(report.minNonCompressedRate, null)
	assertEquals(report.below, false)
})

Deno.test('cache report tolerates stripped records without requests', () => {
	const report = buildCacheReport([
		{ id: 'g1', startedAt: 1, requestCount: 2, requestsStripped: true },
	])
	assertEquals(report.generations[0].requests, [])
	assertEquals(report.minNonCompressedRate, null)
	assertEquals(report.below, false)
})
