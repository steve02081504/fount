/* global Deno */
/**
 * benchmark.mjs 纯函数测试：基准/用例归一化、裁判提示词、裁判回复解析与运行统计。
 */
import { assertEquals, assertThrows } from 'jsr:@std/assert'

import {
	buildJudgePrompt,
	computeStats,
	normalizeBenchmark,
	normalizeCase,
	normalizeForMatch,
	normalizeJudgeScore,
	parseJudgeResponse,
} from '../../src/benchmark.mjs'

Deno.test('normalizeBenchmark fills defaults and auto-ids cases', () => {
	const benchmark = normalizeBenchmark({
		name: '  demo  ',
		cases: [{ input: 'hi' }, { id: 'c2', input: 'hey', expected: 'yo', criteria: 'be nice' }],
	})
	assertEquals(benchmark.name, 'demo')
	assertEquals(benchmark.description, '')
	assertEquals(benchmark.cases[0], { id: 'case-1', input: 'hi' })
	assertEquals(benchmark.cases[1], { id: 'c2', input: 'hey', expected: 'yo', criteria: 'be nice' })
})

Deno.test('normalizeBenchmark rejects a missing name', () => {
	assertThrows(() => normalizeBenchmark({ cases: [] }), Error, 'benchmark name is required')
})

Deno.test('normalizeCase coerces fields to strings', () => {
	assertEquals(normalizeCase({ input: 42, expected: 7 }, 3).id, 'case-4')
	assertEquals(normalizeCase({ input: 42, expected: 7 }, 3).input, '42')
	assertEquals(normalizeCase({ input: 42, expected: 7 }, 3).expected, '7')
})

Deno.test('normalizeForMatch collapses whitespace', () => {
	assertEquals(normalizeForMatch('  a \n b\t'), 'a b')
	assertEquals(normalizeForMatch(null), '')
})

Deno.test('buildJudgePrompt embeds criteria, expected, input and response', () => {
	const prompt = buildJudgePrompt({
		case: { input: 'Q', expected: 'E', criteria: 'C' },
		response: 'R',
	})
	assertEquals(prompt.includes('评分标准：\nC'), true)
	assertEquals(prompt.includes('参考答案：\nE'), true)
	assertEquals(prompt.includes('用例输入：\nQ'), true)
	assertEquals(prompt.includes('待评分回复：\nR'), true)
	assertEquals(prompt.includes('"score"'), true)
})

Deno.test('parseJudgeResponse reads a JSON object and a fenced block', () => {
	assertEquals(parseJudgeResponse('{"score": 0.75, "reason": "good"}'), { score: 0.75, reason: 'good' })
	assertEquals(parseJudgeResponse('```json\n{"score": 1, "reason": "perfect"}\n```'), { score: 1, reason: 'perfect' })
})

Deno.test('parseJudgeResponse falls back to regex and clamps', () => {
	assertEquals(parseJudgeResponse('I think score: 0.4 because reasons').score, 0.4)
	assertEquals(parseJudgeResponse('score: 150').score, 1)
	assertEquals(parseJudgeResponse('score: -3').score, 0)
	assertEquals(parseJudgeResponse('no score at all').score, null)
})

Deno.test('normalizeJudgeScore maps percentages to the unit range', () => {
	assertEquals(normalizeJudgeScore('80'), 0.8)
	assertEquals(normalizeJudgeScore(0.2), 0.2)
	assertEquals(normalizeJudgeScore('abc'), null)
})

Deno.test('computeStats aggregates counts, lengths, exact matches and scores', () => {
	const results = [
		{ caseId: 'a', response: 'yes', judge: { score: 1 } },
		{ caseId: 'b', response: '   ', judge: { score: 0.5 } },
		{ caseId: 'c', response: 'nope' },
	]
	const cases = [
		{ id: 'a', expected: 'yes' },
		{ id: 'b', expected: 'yes' },
		{ id: 'c' },
	]
	const stats = computeStats(results, cases)
	assertEquals(stats.total, 3)
	assertEquals(stats.empty, 1)
	assertEquals(stats.avgLength, 3.33)
	assertEquals(stats.judged, 2)
	assertEquals(stats.avgScore, 0.75)
	assertEquals(stats.exactMatch, 0.5)
})

Deno.test('computeStats omits optional fields when not applicable', () => {
	const stats = computeStats([{ caseId: 'a', response: 'x' }], [{ id: 'a' }])
	assertEquals('exactMatch' in stats, false)
	assertEquals('avgScore' in stats, false)
	assertEquals(stats.judged, 0)
})
