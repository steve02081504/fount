/* global Deno */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { ms } from '../scripts/ms.mjs'
import { timingFilePath } from '../scripts/test/core/paths.mjs'
import {
	getSuiteBaselineDurationMs,
	loadTimingsForSuites,
	readTimings,
	recordSuiteBaselineTiming,
	shouldRecordTimingBaseline,
	writeTimings,
} from '../scripts/test/core/timings.mjs'
import {
	DEFAULT_DURATION_TIMEOUT_MS,
	evaluateWatchdog,
	getDurationWatchdogLimitMs,
	IDLE_TIMEOUT_MS,
	MIN_DURATION_TIMEOUT_MS,
} from '../scripts/test/runner/run_command.mjs'

Deno.test('evaluateWatchdog idle when no recent output', () => {
	const now = 1_000_000
	assertEquals(evaluateWatchdog({
		now,
		startedAt: now - IDLE_TIMEOUT_MS - 1,
		lastActivityAt: now - IDLE_TIMEOUT_MS,
	}), 'idle')
})

Deno.test('evaluateWatchdog duration when over 2x baseline', () => {
	const now = 1_000_000
	assertEquals(evaluateWatchdog({
		now,
		startedAt: now - ms('6m') - 1,
		lastActivityAt: now - ms('1s'),
		baselineDurationMs: ms('3m'),
	}), 'duration')
})

Deno.test('getDurationWatchdogLimitMs enforces 5 minute minimum', () => {
	assertEquals(getDurationWatchdogLimitMs(ms('23s')), MIN_DURATION_TIMEOUT_MS)
})

Deno.test('evaluateWatchdog duration waits for 5 minute minimum on short baseline', () => {
	const now = 1_000_000
	assertEquals(evaluateWatchdog({
		now,
		startedAt: now - MIN_DURATION_TIMEOUT_MS + 1,
		lastActivityAt: now - ms('1s'),
		baselineDurationMs: ms('23s'),
	}), null)
	assertEquals(evaluateWatchdog({
		now,
		startedAt: now - MIN_DURATION_TIMEOUT_MS,
		lastActivityAt: now - ms('1s'),
		baselineDurationMs: ms('23s'),
	}), 'duration')
})

Deno.test('evaluateWatchdog idle takes priority over duration', () => {
	const now = 1_000_000
	assertEquals(evaluateWatchdog({
		now,
		startedAt: now - IDLE_TIMEOUT_MS - 1,
		lastActivityAt: now - IDLE_TIMEOUT_MS,
		baselineDurationMs: ms('1s'),
	}), 'idle')
})

Deno.test('evaluateWatchdog null when within limits', () => {
	const now = 100_000
	assertEquals(evaluateWatchdog({
		now,
		startedAt: now - ms('5s'),
		lastActivityAt: now - ms('1s'),
		baselineDurationMs: ms('10s'),
	}), null)
})

Deno.test('evaluateWatchdog uses default 30 minute limit without baseline', () => {
	const now = 1_000_000
	assertEquals(evaluateWatchdog({
		now,
		startedAt: now - DEFAULT_DURATION_TIMEOUT_MS + 1,
		lastActivityAt: now - ms('1s'),
	}), null)
	assertEquals(evaluateWatchdog({
		now,
		startedAt: now - DEFAULT_DURATION_TIMEOUT_MS,
		lastActivityAt: now - ms('1s'),
	}), 'duration')
})

Deno.test('getDurationWatchdogLimitMs keeps 2x baseline for long suites', () => {
	assertEquals(getDurationWatchdogLimitMs(ms('4m')), ms('8m'))
})

Deno.test('getDurationWatchdogLimitMs falls back to default 30 minutes without baseline', () => {
	assertEquals(getDurationWatchdogLimitMs(undefined), DEFAULT_DURATION_TIMEOUT_MS)
})

Deno.test('shouldRecordTimingBaseline records pass and non-terminated failure only', () => {
	assertEquals(shouldRecordTimingBaseline({ passed: true, terminated: false }), true)
	assertEquals(shouldRecordTimingBaseline({ passed: false, terminated: false }), true)
	assertEquals(shouldRecordTimingBaseline({ passed: false, terminated: true }), false)
})

Deno.test('timings read write and merge', async () => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'fount-timings-test-'))
	try {
		const suite = {
			manifestId: 'shells/chat',
			name: 'unit',
			id: 'unit',
			run: [],
			triggers: [],
			manifestPath: '',
			heavy: false,
		}
		assertEquals(await readTimings(repoRoot, 'shells/chat'), { items: {} })

		const updated = recordSuiteBaselineTiming({ items: {} }, 'unit', ms('42s'))
		await writeTimings(repoRoot, 'shells/chat', updated)

		const raw = JSON.parse(await readFile(timingFilePath(repoRoot, 'shells/chat'), 'utf8'))
		assertEquals(raw.items.unit.baselineDurationMs, ms('42s'))
		assertEquals(typeof raw.items.unit.recordedAt, 'string')

		const loaded = await loadTimingsForSuites(repoRoot, [suite])
		assertEquals(getSuiteBaselineDurationMs(loaded.get('shells/chat'), 'unit'), ms('42s'))

		const overwritten = recordSuiteBaselineTiming(updated, 'unit', ms('57s'))
		assertEquals(getSuiteBaselineDurationMs(overwritten, 'unit'), ms('57s'))
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})
