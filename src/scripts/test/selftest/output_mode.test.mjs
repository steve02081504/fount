/**
 * 输出模式：human / plain / json 解析与事件行格式。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createEventEmitter, formatPlainEvent, resolveOutputMode } from '../display/output.mjs'

Deno.test('resolveOutputMode: explicit request wins over env and TTY', () => {
	assertEquals(resolveOutputMode({ requested: 'json', isTTY: true, env: { FOUNT_TEST_OUTPUT: 'plain' } }), 'json')
	assertEquals(resolveOutputMode({ requested: 'plain', isTTY: true, env: {} }), 'plain')
})

Deno.test('resolveOutputMode: env var used when no explicit request', () => {
	assertEquals(resolveOutputMode({ isTTY: true, env: { FOUNT_TEST_OUTPUT: 'json' } }), 'json')
})

Deno.test('resolveOutputMode: unknown env value falls back to plain (never the spammy human line log)', () => {
	assertEquals(resolveOutputMode({ isTTY: false, env: { FOUNT_TEST_OUTPUT: 'nonsense' } }), 'plain')
})

Deno.test('resolveOutputMode: non-TTY defaults to plain, TTY to human', () => {
	assertEquals(resolveOutputMode({ isTTY: false, env: {} }), 'plain')
	assertEquals(resolveOutputMode({ isTTY: true, env: {} }), 'human')
})

Deno.test('formatPlainEvent renders terse single-line events', () => {
	assertEquals(formatPlainEvent({
		type: 'accepted',
		goalCount: 2,
		total: 10,
		runCount: 2,
		reuseCount: 0,
		blockedCount: 0,
		skippedCount: 0,
	}), '[test] selected 2/10 · run 2 · reuse 0 · blocked 0')
	assertEquals(formatPlainEvent({ type: 'suite-start', key: 'checks:a', expectedMs: 3000 }), '[test] start checks:a (eta 3 秒)')
	assertEquals(formatPlainEvent({ type: 'suite-end', key: 'checks:a', passed: true, durationMs: 1000 }), '[test] ok checks:a (1 秒)')
	assertEquals(formatPlainEvent({ type: 'suite-end', key: 'checks:a', passed: false, durationMs: 1000 }), '[test] fail checks:a (1 秒)')
	assertEquals(formatPlainEvent({ type: 'suite-end', key: 'checks:a', reused: true }), '[test] reuse checks:a')
	assertEquals(formatPlainEvent({ type: 'job-wait', aheadCount: 3 }), '[test] waiting behind 3 other job(s)')
	assertEquals(formatPlainEvent({ type: 'progress', running: ['a', 'b'], elapsedMs: 1000 }), '[test] running a, b (elapsed 1 秒)')
	assertEquals(formatPlainEvent({ type: 'job-done', exitCode: 0, passed: 2, failed: 0, durationMs: 1000, reportPath: 'data/test/report.md' }),
		'[test] done exit=0 passed=2 failed=0 (1 秒) · report data/test/report.md')
})

Deno.test('formatPlainEvent: accepted error is a single error line', () => {
	assertEquals(formatPlainEvent({ type: 'accepted', error: 'deadTriggers', code: 1 }), '[test] error deadTriggers (exit 1)')
})

Deno.test('createEventEmitter json emits parseable NDJSON per event', () => {
	const lines = []
	const emit = createEventEmitter('json', line => lines.push(line))
	emit({ type: 'suite-end', key: 'checks:a', passed: true })
	emit({ type: 'job-done', exitCode: 0 })
	assertEquals(lines.length, 2)
	const first = JSON.parse(lines[0])
	assertEquals(first.type, 'suite-end')
	assertEquals(first.key, 'checks:a')
	assertEquals(typeof first.ts, 'number')
	// 每行恰好一个 JSON 对象，便于逐行解析。
	assertEquals(lines.every(line => line.endsWith('\n')), true)
	assertEquals(JSON.parse(lines[1]).exitCode, 0)
})

Deno.test('createEventEmitter plain emits terse lines', () => {
	const lines = []
	const emit = createEventEmitter('plain', line => lines.push(line))
	emit({ type: 'suite-start', key: 'checks:a', expectedMs: null })
	assertEquals(lines, ['[test] start checks:a\n'])
})
