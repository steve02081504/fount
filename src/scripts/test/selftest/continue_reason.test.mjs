/* global Deno */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { reportJsonPath, reportMarkdownPath } from '../core/paths.mjs'
import { collectTriggerEvidence, suiteKey } from '../core/state.mjs'
import {
	buildContinueReasonsForSuites,
	buildImperfectContinueReason,
	pendingContinueReason,
} from '../runner/continue_reason.mjs'
import { RunReportWriter } from '../runner/report.mjs'

/** @type {import('../core/manifest.mjs').SuiteDef} */
function suite(manifestId, name, triggers = [`src/${manifestId}/**`]) {
	return {
		manifestId,
		name,
		id: name,
		run: [],
		triggers,
		manifestPath: '',
		heavy: false,
	}
}

Deno.test('pendingContinueReason is pending_from_previous_report', () => {
	assertEquals(pendingContinueReason(), { kind: 'pending_from_previous_report' })
})

Deno.test('buildImperfectContinueReason detects missing state record', () => {
	const s = suite('p2p', 'pure')
	assertEquals(
		buildImperfectContinueReason(s, undefined, 'head1', null, []),
		{ kind: 'missing_state_record', toCommit: 'head1', toUncommittedHash: null },
	)
})

Deno.test('buildImperfectContinueReason detects failed noisy blocked', () => {
	const s = suite('p2p', 'live')
	const base = {
		commitHash: 'abc',
		uncommittedHash: null,
		ranAt: '',
		durationMs: 1,
		failedFiles: [],
		noiseHits: [],
		logPath: null,
	}
	assertEquals(
		buildImperfectContinueReason(s, { ...base, status: 'failed' }, 'head2', null, []).kind,
		'imperfect_failed',
	)
	assertEquals(
		buildImperfectContinueReason(s, { ...base, status: 'noisy' }, 'head2', null, []).kind,
		'imperfect_noisy',
	)
	assertEquals(
		buildImperfectContinueReason(s, { ...base, status: 'blocked', blockedBy: ['server/live'] }, 'head2', null, []).kind,
		'imperfect_blocked',
	)
})

Deno.test('buildImperfectContinueReason detects outdated trigger hit with evidence', () => {
	const s = suite('shells/chat', 'pure', ['src/public/parts/shells/chat/**'])
	const entry = {
		status: 'passed',
		commitHash: 'abc123',
		uncommittedHash: 'oldhash',
		ranAt: '',
		durationMs: 1,
		failedFiles: [],
		noiseHits: [],
		logPath: null,
	}
	const changed = ['src/public/parts/shells/chat/foo.mjs', 'README.md']
	const reason = buildImperfectContinueReason(s, entry, 'def456', 'newhash', changed)
	assertEquals(reason.kind, 'outdated_trigger_hit')
	assertEquals(reason.fromCommit, 'abc123')
	assertEquals(reason.toCommit, 'def456')
	assertEquals(reason.fromUncommittedHash, 'oldhash')
	assertEquals(reason.toUncommittedHash, 'newhash')
	assertEquals(reason.matchedTriggers, ['src/public/parts/shells/chat/**'])
	assertEquals(reason.matchedPaths, ['src/public/parts/shells/chat/foo.mjs'])
})

Deno.test('collectTriggerEvidence returns empty when no hit', () => {
	const s = suite('shells/chat', 'pure', ['src/public/parts/shells/chat/**'])
	assertEquals(collectTriggerEvidence(s, ['README.md']), {
		matchedTriggers: [],
		matchedPaths: [],
	})
})

Deno.test('buildContinueReasonsForSuites maps each suite key', () => {
	const suites = [suite('p2p', 'pure'), suite('p2p', 'live')]
	const state = {
		suites: {
			'p2p/live': {
				status: 'failed',
				commitHash: 'abc',
				uncommittedHash: null,
				ranAt: '',
				durationMs: 1,
				failedFiles: [],
				noiseHits: [],
				logPath: null,
			},
		},
	}
	const changed = new Map(suites.map(s => [suiteKey(s.manifestId, s.name), []]))
	const reasons = buildContinueReasonsForSuites(suites, state, 'head', null, changed)
	assertEquals(reasons.get('p2p/pure')?.kind, 'missing_state_record')
	assertEquals(reasons.get('p2p/live')?.kind, 'imperfect_failed')
})

Deno.test('RunReportWriter persists continueReason in report.json and markdown', async () => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'fount-continue-reason-'))
	try {
		const suites = [suite('testkit', 'selftest')]
		const continueReasons = new Map([
			['testkit/selftest', {
				kind: 'outdated_trigger_hit',
				fromCommit: 'abc123456789',
				toCommit: 'def456789abc',
				fromUncommittedHash: null,
				toUncommittedHash: null,
				matchedTriggers: ['src/scripts/test/**'],
				matchedPaths: ['src/scripts/test/foo.mjs'],
			}],
		])
		const writer = new RunReportWriter({
			repoRoot,
			suites,
			runId: 'run-continue',
			command: 'fount test --continue',
			commitHash: 'def456789abc',
			uncommittedHash: null,
			continueReasons,
		})
		await writer.init()
		const json = JSON.parse(await readFile(reportJsonPath(repoRoot), 'utf8'))
		assertEquals(json.slots[0].continueReason.kind, 'outdated_trigger_hit')
		assertEquals(json.slots[0].continueReason.matchedPaths, ['src/scripts/test/foo.mjs'])

		const md = await readFile(reportMarkdownPath(repoRoot), 'utf8')
		assertStringIncludes(md, '续跑原因')
		assertStringIncludes(md, 'trigger 命中')
		assertStringIncludes(md, 'src/scripts/test/foo.mjs')
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})

Deno.test('RunReportWriter.stampContinueReasons updates pending slots on resume', async () => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'fount-continue-stamp-'))
	try {
		const suites = [
			suite('testkit', 'a'),
			suite('testkit', 'b'),
		]
		const writer = new RunReportWriter({
			repoRoot,
			suites,
			runId: 'run-partial',
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

		const resumed = await RunReportWriter.resume(repoRoot)
		resumed.command = 'fount test --continue'
		await resumed.stampContinueReasons(new Map([
			['testkit/b', pendingContinueReason()],
		]))

		const json = JSON.parse(await readFile(reportJsonPath(repoRoot), 'utf8'))
		assertEquals(json.slots[0].continueReason, undefined)
		assertEquals(json.slots[1].continueReason, { kind: 'pending_from_previous_report' })
		assertEquals(json.command, 'fount test --continue')

		const md = await readFile(reportMarkdownPath(repoRoot), 'utf8')
		assertStringIncludes(md, '续跑原因')
		assertStringIncludes(md, '上次运行中断')
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})
