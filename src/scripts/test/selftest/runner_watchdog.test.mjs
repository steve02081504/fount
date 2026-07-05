/* global Deno */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { ms } from '../../ms.mjs'
import { reportJsonPath } from '../core/paths.mjs'
import {
	getSuiteBaselineDurationMs,
	readState,
	shouldRecordTimingBaseline,
	suiteKey,
	upsertSuiteRun,
	writeState,
} from '../core/state.mjs'
import { exitCodeFromSlots, RunReportWriter } from '../runner/report.mjs'
import {
	DEFAULT_DURATION_TIMEOUT_MS,
	evaluateWatchdog,
	getDurationWatchdogLimitMs,
	IDLE_TIMEOUT_MS,
	MIN_DURATION_TIMEOUT_MS,
} from '../runner/run_command.mjs'

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

Deno.test('state baseline timing via upsertSuiteRun', async () => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'fount-state-timing-'))
	try {
		const suiteDef = {
			manifestId: 'shells/chat',
			name: 'pure',
			id: 'pure',
			run: [],
			triggers: [],
			manifestPath: '',
			heavy: false,
		}
		const state = await readState(repoRoot)
		await upsertSuiteRun({
			repoRoot,
			state,
			suite: suiteDef,
			result: { passed: true, failedFiles: [], output: '', durationMs: ms('42s') },
			commitHash: 'abc',
			uncommittedHash: null,
		})
		assertEquals(getSuiteBaselineDurationMs(state.suites[suiteKey('shells/chat', 'pure')]), ms('42s'))
		await writeState(repoRoot, state)
		const reloaded = await readState(repoRoot)
		assertEquals(getSuiteBaselineDurationMs(reloaded.suites['shells/chat/pure']), ms('42s'))
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})

Deno.test('RunReportWriter tracks pending slots for continue', async () => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'fount-report-test-'))
	try {
		const suites = [{
			manifestId: 'testkit',
			name: 'selftest',
			id: 'selftest',
			run: [],
			triggers: [],
			manifestPath: '',
			heavy: false,
		}]
		const writer = new RunReportWriter({
			repoRoot,
			suites,
			runId: 'run-1',
			command: 'fount test testkit',
			commitHash: 'abc',
			uncommittedHash: null,
		})
		await writer.init()
		await writer.recordResult(0, {
			status: 'passed',
			commitHash: 'abc',
			uncommittedHash: null,
			ranAt: new Date().toISOString(),
			durationMs: 1,
			failedFiles: [],
			noiseHits: [],
			logPath: null,
		})
		await writer.finalize(0)
		const resumed = await RunReportWriter.resume(repoRoot)
		assertEquals(resumed, null)

		const writer2 = new RunReportWriter({
			repoRoot,
			suites,
			runId: 'run-2',
			command: 'fount test testkit',
			commitHash: 'abc',
			uncommittedHash: null,
		})
		await writer2.init()
		const raw = JSON.parse(await readFile(reportJsonPath(repoRoot), 'utf8'))
		assertEquals(raw.slots[0].state, 'pending')
		const resumed2 = await RunReportWriter.resume(repoRoot)
		assertEquals(resumed2?.pendingSlots.length, 1)
		assertEquals(exitCodeFromSlots(resumed2.slots.filter(s => s.state === 'done')), 0)
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})
