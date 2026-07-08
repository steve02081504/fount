/* global Deno */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { reportJsonPath, reportMarkdownPath, triggeredReasonsMarkdownPath } from '../core/paths.mjs'
import { collectTriggerEvidence, suiteKey } from '../core/state.mjs'
import {
	buildContinueReasonsForSuites,
	buildDepGateReason,
	buildDependencyContinueReason,
	buildDiffSelectionReasons,
	buildImperfectContinueReason,
	buildInclusionPath,
	findDirectRequiredBy,
	pendingContinueReason,
	resolveRootKeyFromProvenance,
	stampExpansionReasons,
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

/** @type {import('../core/manifest.mjs').SuiteDef} */
function depSuite(manifestId, name, dependsOn = []) {
	const s = suite(manifestId, name)
	s.dependencies = dependsOn.map(d => {
		const colon = d.indexOf(':')
		return colon >= 0
			? { manifestId: d.slice(0, colon), name: d.slice(colon + 1) }
			: { manifestId, name: d }
	})
	return s
}

Deno.test('findDirectRequiredBy resolves upstream and downstream inclusion', () => {
	const live = depSuite('server', 'live')
	const smoke = depSuite('shells/chat', 'smoke_chat', ['server:live'])
	const e2e = depSuite('shells/chat', 'e2e_single', ['server:live', 'smoke_chat'])
	const frontend = depSuite('shells/chat', 'frontend', ['server:live', 'e2e_single'])
	const selected = [live, smoke, e2e, frontend]
	const seeds = new Set(['shells/chat/frontend'])
	assertEquals(findDirectRequiredBy('server/live', selected, seeds), 'shells/chat/frontend')
	assertEquals(findDirectRequiredBy('shells/chat/smoke_chat', selected, seeds), 'shells/chat/e2e_single')
	assertEquals(findDirectRequiredBy('shells/chat/e2e_single', selected, seeds), 'shells/chat/frontend')
})

Deno.test('findDirectRequiredBy resolves federation downstream deps', () => {
	const p2pLive = depSuite('p2p', 'live')
	const fedCore = depSuite('shells/chat', 'fed_core', ['server:live', 'p2p:sim', 'p2p:live'])
	const fedE2e = depSuite('shells/chat', 'fed_e2e_ext', ['fed_core'])
	const selected = [p2pLive, fedCore, fedE2e]
	const seeds = new Set(['p2p/live'])
	assertEquals(findDirectRequiredBy('shells/chat/fed_core', selected, seeds), 'p2p/live')
	assertEquals(findDirectRequiredBy('shells/chat/fed_e2e_ext', selected, seeds), 'shells/chat/fed_core')
})

Deno.test('stampExpansionReasons uses provenance and marks explicit seeds', () => {
	const live = depSuite('server', 'live')
	const smoke = depSuite('shells/chat', 'smoke_chat', ['server:live'])
	const e2e = depSuite('shells/chat', 'e2e_single', ['server:live', 'smoke_chat'])
	const frontend = depSuite('shells/chat', 'frontend', ['server:live', 'e2e_single'])
	const selected = [live, smoke, e2e, frontend]
	const seeds = new Set(['shells/chat/frontend'])
	const provenance = new Map([
		['shells/chat/e2e_single', 'shells/chat/frontend'],
		['shells/chat/smoke_chat', 'shells/chat/e2e_single'],
		['server/live', 'shells/chat/smoke_chat'],
	])
	/** @type {Map<string, import('../runner/continue_reason.mjs').ContinueReason>} */
	const reasons = new Map()
	const state = { suites: {} }
	const context = {
		commitHash: 'head1',
		uncommittedHash: null,
		changedSinceRecordByKey: new Map(selected.map(s => [suiteKey(s.manifestId, s.name), []])),
		byKey: new Map(selected.map(s => [suiteKey(s.manifestId, s.name), s])),
	}
	stampExpansionReasons(reasons, selected, seeds, provenance, { explicitSuites: true, state, context })
	assertEquals(reasons.get('shells/chat/frontend')?.kind, 'explicit_selected')
	assertEquals(reasons.get('shells/chat/e2e_single')?.requiredBy, 'shells/chat/frontend')
	assertEquals(reasons.get('shells/chat/smoke_chat')?.requiredBy, 'shells/chat/e2e_single')
})

Deno.test('buildDependencyContinueReason traces root, path, and gate', () => {
	const live = depSuite('server', 'live')
	const smoke = depSuite('shells/chat', 'smoke_chat', ['server:live'])
	const e2e = depSuite('shells/chat', 'e2e_single', ['server:live', 'smoke_chat'])
	const frontend = depSuite('shells/chat', 'frontend', ['server:live', 'e2e_single'])
	const selected = [live, smoke, e2e, frontend]
	const seeds = new Set(['shells/chat/frontend'])
	const provenance = new Map([
		['shells/chat/e2e_single', 'shells/chat/frontend'],
		['shells/chat/smoke_chat', 'shells/chat/e2e_single'],
	])
	/** @type {Map<string, import('../runner/continue_reason.mjs').ContinueReason>} */
	const reasons = new Map([['shells/chat/frontend', { kind: 'explicit_selected' }]])
	const state = { suites: {} }
	const reason = buildDependencyContinueReason({
		key: 'shells/chat/smoke_chat',
		requiredBy: 'shells/chat/e2e_single',
		selected,
		provenance,
		reasons,
		seedKeys: seeds,
		state,
		context: {
			commitHash: 'head1',
			uncommittedHash: null,
			changedSinceRecordByKey: new Map([['shells/chat/smoke_chat', []]]),
			byKey: new Map(selected.map(s => [suiteKey(s.manifestId, s.name), s])),
		},
	})
	assertEquals(reason.rootKey, 'shells/chat/frontend')
	assertEquals(reason.rootKind, 'explicit_selected')
	assertEquals(reason.pull, 'upstream')
	assertEquals(reason.inclusionPath, ['shells/chat/frontend', 'shells/chat/e2e_single', 'shells/chat/smoke_chat'])
	assertEquals(reason.gate?.kind, 'missing_state_record')
})

Deno.test('resolveRootKeyFromProvenance and buildInclusionPath', () => {
	const provenance = new Map([
		['shells/chat/e2e_single', 'shells/chat/frontend'],
		['shells/chat/smoke_chat', 'shells/chat/e2e_single'],
	])
	const seeds = new Set(['shells/chat/frontend'])
	assertEquals(resolveRootKeyFromProvenance('shells/chat/smoke_chat', provenance, seeds), 'shells/chat/frontend')
	assertEquals(
		buildInclusionPath('shells/chat/smoke_chat', provenance, 'shells/chat/frontend'),
		['shells/chat/frontend', 'shells/chat/e2e_single', 'shells/chat/smoke_chat'],
	)
})

Deno.test('buildDepGateReason detects outdated trigger hit', () => {
	const s = suite('shells/chat', 'smoke_chat', ['src/public/parts/shells/chat/**'])
	const entry = {
		status: 'passed',
		commitHash: 'abc',
		uncommittedHash: null,
		ranAt: '',
		durationMs: 1,
		failedFiles: [],
		noiseHits: [],
		logPath: null,
	}
	const reason = buildDepGateReason(
		s,
		entry,
		'abc',
		null,
		['src/public/parts/shells/chat/foo.mjs'],
	)
	assertEquals(reason.kind, 'outdated_trigger_hit')
	assertEquals(reason.matchedPaths, ['src/public/parts/shells/chat/foo.mjs'])
})

Deno.test('buildDepGateReason rejects commit-only drift', () => {
	const s = suite('server', 'live')
	const entry = {
		status: 'passed',
		commitHash: 'old',
		uncommittedHash: null,
		ranAt: '',
		durationMs: 1,
		failedFiles: [],
		noiseHits: [],
		logPath: null,
	}
	let threw = false
	try {
		buildDepGateReason(s, entry, 'new-head', null, [])
	}
	catch {
		threw = true
	}
	assertEquals(threw, true)
})

Deno.test('buildDiffSelectionReasons maps trigger evidence', () => {
	const s = suite('shells/chat', 'pure', ['src/public/parts/shells/chat/**'])
	const reasons = buildDiffSelectionReasons(
		[s],
		['src/public/parts/shells/chat/foo.mjs'],
		'head',
		'hash',
	)
	assertEquals(reasons.get('shells/chat/pure')?.kind, 'diff_trigger_hit')
	assertEquals(reasons.get('shells/chat/pure')?.matchedPaths, ['src/public/parts/shells/chat/foo.mjs'])
})

Deno.test('RunReportWriter sorts slots dependency-first', async () => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'fount-report-sort-'))
	try {
		const suites = [
			depSuite('shells/chat', 'frontend', ['server:live']),
			depSuite('server', 'live'),
		]
		const writer = new RunReportWriter({
			repoRoot,
			suites,
			runId: 'run-sort',
			command: 'fount test shells/chat:frontend',
			commitHash: 'abc',
			uncommittedHash: null,
		})
		assertEquals(
			writer.slots.map(s => `${s.manifestId}/${s.name}`),
			['server/live', 'shells/chat/frontend'],
		)
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})

Deno.test('RunReportWriter lists pending slots without inline reasons', async () => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'fount-pending-reason-'))
	try {
		const suites = [
			depSuite('server', 'live'),
			depSuite('shells/chat', 'frontend', ['server:live']),
		]
		const continueReasons = new Map([
			['server/live', {
				kind: 'dependency_required',
				requiredBy: 'shells/chat/frontend',
			}],
		])
		const writer = new RunReportWriter({
			repoRoot,
			suites,
			runId: 'run-pending-reason',
			command: 'fount test shells/chat:frontend',
			commitHash: 'abc',
			uncommittedHash: null,
			continueReasons,
		})
		await writer.init()
		const md = await readFile(reportMarkdownPath(repoRoot), 'utf8')
		assertStringIncludes(md, '## 待运行')
		assertStringIncludes(md, '- server/live')
		assertStringIncludes(md, '触发原因：详见 [./triggered-reasons.md]')
		if (md.includes('server/live — '))
			throw new Error('pending section should not inline trigger reasons')
		const reasons = await readFile(triggeredReasonsMarkdownPath(repoRoot), 'utf8')
		assertStringIncludes(reasons, '# 触发原因')
		assertStringIncludes(reasons, '直接纳入方')
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})

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

Deno.test('RunReportWriter renders rich dependency trigger reasons', async () => {
	const repoRoot = await mkdtemp(join(tmpdir(), 'fount-dep-reason-'))
	try {
		const suites = [depSuite('shells/chat', 'smoke_chat', ['server:live'])]
		const continueReasons = new Map([
			['shells/chat/smoke_chat', {
				kind: 'dependency_required',
				requiredBy: 'shells/chat/e2e_single',
				pull: 'upstream',
				rootKey: 'shells/chat/frontend',
				rootKind: 'explicit_selected',
				inclusionPath: ['shells/chat/frontend', 'shells/chat/e2e_single', 'shells/chat/smoke_chat'],
				gate: { kind: 'missing_state_record', toCommit: 'head1', toUncommittedHash: null },
			}],
		])
		const writer = new RunReportWriter({
			repoRoot,
			suites,
			runId: 'run-dep-reason',
			command: 'fount test shells/chat:frontend',
			commitHash: 'head1',
			uncommittedHash: null,
			continueReasons,
		})
		await writer.init()
		const reasons = await readFile(triggeredReasonsMarkdownPath(repoRoot), 'utf8')
		assertStringIncludes(reasons, '根因: 显式指名（`shells/chat/frontend`）')
		assertStringIncludes(reasons, '纳入链')
		assertStringIncludes(reasons, '需跑原因: state 无记录，自动补跑')
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
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
		assertStringIncludes(md, '触发原因：详见 [./triggered-reasons.md]')
		const reasons = await readFile(triggeredReasonsMarkdownPath(repoRoot), 'utf8')
		assertStringIncludes(reasons, '# 触发原因')
		assertStringIncludes(reasons, 'trigger 命中')
		assertStringIncludes(reasons, 'src/scripts/test/foo.mjs')
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

		const reasons = await readFile(triggeredReasonsMarkdownPath(repoRoot), 'utf8')
		assertStringIncludes(reasons, '# 触发原因')
		assertStringIncludes(reasons, '上次运行中断')
	}
	finally {
		await rm(repoRoot, { recursive: true, force: true })
	}
})
