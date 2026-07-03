/* global Deno */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { timingFilePath } from '../scripts/test/core/paths.mjs'
import {
	loadTimingsForSuites,
	readTimings,
	recordSuiteSuccessTiming,
	writeTimings,
} from '../scripts/test/core/timings.mjs'
import {
	evaluateWatchdog,
	IDLE_TIMEOUT_MS,
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
	const now = 100_000
	assertEquals(evaluateWatchdog({
		now,
		startedAt: now - 20_001,
		lastActivityAt: now - 1_000,
		baselineDurationMs: 10_000,
	}), 'duration')
})

Deno.test('evaluateWatchdog idle takes priority over duration', () => {
	const now = 1_000_000
	assertEquals(evaluateWatchdog({
		now,
		startedAt: now - IDLE_TIMEOUT_MS - 1,
		lastActivityAt: now - IDLE_TIMEOUT_MS,
		baselineDurationMs: 1_000,
	}), 'idle')
})

Deno.test('evaluateWatchdog null when within limits', () => {
	const now = 100_000
	assertEquals(evaluateWatchdog({
		now,
		startedAt: now - 5_000,
		lastActivityAt: now - 1_000,
		baselineDurationMs: 10_000,
	}), null)
})

Deno.test('evaluateWatchdog skips duration without baseline', () => {
	const now = 1_000_000
	assertEquals(evaluateWatchdog({
		now,
		startedAt: now - 999_999,
		lastActivityAt: now - 1_000,
	}), null)
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

		const updated = recordSuiteSuccessTiming({ items: {} }, 'unit', 42_000)
		await writeTimings(repoRoot, 'shells/chat', updated)

		const raw = JSON.parse(await readFile(timingFilePath(repoRoot, 'shells/chat'), 'utf8'))
		assertEquals(raw.items.unit.durationMs, 42_000)
		assertEquals(typeof raw.items.unit.recordedAt, 'string')

		const loaded = await loadTimingsForSuites(repoRoot, [suite])
		assertEquals(loaded.get('shells/chat')?.items.unit.durationMs, 42_000)
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})
