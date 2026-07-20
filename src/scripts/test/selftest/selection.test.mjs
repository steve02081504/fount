/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { resolveSelector } from '../core/selector.mjs'
import { collectStaleTriggerEvidence, migrateLegacySuiteKey, migrateLegacyStateSuites } from '../core/state.mjs'
import { judgeSuite } from '../core/verdict.mjs'
import {
	goalExplicit,
	goalImperfectKeys,
	goalOutdated,
	selectImperfectWave,
	selectOutdatedWave,
} from '../runner/selection.mjs'

import { makeStateEntry, makeSuite } from './fixtures.mjs'

Deno.test('resolveSelector slash form matches longest manifest prefix', () => {
	const known = ['server', 'shells/chat', 'shells/social']
	assertEquals(resolveSelector('shells/chat/fed_core', known)?.manifestId, 'shells/chat')
})

Deno.test('goalExplicit marks every selected suite', () => {
	const suites = [
		{ manifestId: 'server', name: 'live', id: 'live', run: [], triggers: [], manifestPath: '', heavy: false },
	]
	const { goalKeys, goalEvidenceByKey } = goalExplicit(suites)
	assertEquals([...goalKeys], ['server:live'])
	assertEquals(goalEvidenceByKey.get('server:live')?.kind, 'explicit_selected')
})

Deno.test('collectStaleTriggerEvidence maps paths to trigger sets', () => {
	const suite = makeSuite('shells/chat', 'pure', {
		triggerRefs: ['testFramework', 'shellPureTests'],
		triggerSetPatterns: {
			testFramework: ['src/scripts/test/deno/serial.mjs'],
			shellPureTests: ['src/public/parts/shells/chat/test/pure/**'],
		},
		triggers: [
			'src/scripts/test/deno/serial.mjs',
			'src/public/parts/shells/chat/test/pure/**',
		],
	})
	const evidence = collectStaleTriggerEvidence(suite, ['src/scripts/test/deno/serial.mjs'])
	assertEquals(evidence.matchedTriggerSets, ['testFramework'])
	assertEquals(evidence.matchedPaths, ['src/scripts/test/deno/serial.mjs'])
	assertEquals(evidence.triggerHashDrift, false)
})

Deno.test('collectStaleTriggerEvidence includes subtest triggers and hash drift', () => {
	const suite = makeSuite('shells/chat', 'frontend', {
		triggers: ['src/public/parts/shells/chat/test/frontend/fixtures.mjs'],
		subtests: [{
			name: 'smoke',
			triggers: ['src/public/parts/shells/chat/test/frontend/smoke.spec.mjs'],
		}],
	})
	const withPaths = collectStaleTriggerEvidence(suite, [
		'src/public/parts/shells/chat/test/frontend/smoke.spec.mjs',
	])
	assertEquals(withPaths.matchedPaths, ['src/public/parts/shells/chat/test/frontend/smoke.spec.mjs'])
	assertEquals(withPaths.triggerHashDrift, false)

	const drift = collectStaleTriggerEvidence(suite, [], {
		entry: makeStateEntry({ triggerHash: 'old' }),
		currentTriggerHash: null,
	})
	assertEquals(drift.triggerHashDrift, true)
	assertEquals(drift.matchedPaths, [])
})

Deno.test('selectImperfectWave exits when nothing imperfect in scope', () => {
	const all = [makeSuite('shells/chat', 'pure')]
	const state = { suites: { 'shells/chat:pure': makeStateEntry({ status: 'passed' }) } }
	const verdicts = new Map([['shells/chat:pure', { kind: 'green', fresh: true, triggerHash: null }]])
	const selection = selectImperfectWave({
		verdicts,
		state,
		allSuites: all,
		scope: all,
		commitHash: 'abc',
		uncommittedHash: null,
	})
	assertEquals(selection.action, 'exit')
})

Deno.test('selectImperfectWave includes fresh noisy without expanding dependents', () => {
	const all = [
		makeSuite('shells/chat', 'smoke_chat'),
		makeSuite('shells/chat', 'ws', { dependsOn: ['smoke_chat'] }),
	]
	const state = {
		suites: {
			'shells/chat:smoke_chat': makeStateEntry({ status: 'noisy' }),
			'shells/chat:ws': makeStateEntry({ status: 'passed' }),
		},
	}
	const verdicts = new Map([
		['shells/chat:smoke_chat', { kind: 'noisy', fresh: true, triggerHash: null }],
		['shells/chat:ws', { kind: 'green', fresh: true, triggerHash: null }],
	])
	const selection = selectImperfectWave({
		verdicts,
		state,
		allSuites: all,
		scope: all,
		commitHash: 'abc',
		uncommittedHash: null,
	})
	assertEquals(selection.action, 'run')
	assertEquals([...selection.goalKeys].sort(), ['shells/chat:smoke_chat'])
	assertEquals(selection.goalEvidenceByKey.get('shells/chat:smoke_chat')?.kind, 'imperfect_noisy')
})

Deno.test('goalOutdated picks unknown in scope', () => {
	const scope = [makeSuite('shells/chat', 'pure'), makeSuite('shells/chat', 'live')]
	const verdicts = new Map([
		['shells/chat:pure', { kind: 'unknown', fresh: false, triggerHash: null }],
		['shells/chat:live', { kind: 'green', fresh: true, triggerHash: null }],
	])
	assertEquals([...goalOutdated(verdicts, scope)], ['shells/chat:pure'])
})

Deno.test('selectOutdatedWave attaches stale_content evidence', () => {
	const all = [makeSuite('shells/chat', 'pure', { triggers: ['src/a.mjs'] })]
	const state = { suites: { 'shells/chat:pure': makeStateEntry({ status: 'passed', commitHash: 'old' }) } }
	const verdicts = new Map([['shells/chat:pure', { kind: 'unknown', fresh: false, triggerHash: null }]])
	const selection = selectOutdatedWave({
		verdicts,
		scope: all,
		allSuites: all,
		committedChangedByKey: new Map([['shells/chat:pure', ['src/a.mjs']]]),
		commitHash: 'new',
		uncommittedHash: null,
		state,
	})
	assertEquals(selection.action, 'run')
	assertEquals(selection.goalEvidenceByKey.get('shells/chat:pure')?.kind, 'stale_content')
})

Deno.test('migrateLegacySuiteKey converts slash suite keys', () => {
	assertEquals(migrateLegacySuiteKey('shells/chat/frontend'), 'shells/chat:frontend')
	assertEquals(migrateLegacySuiteKey('shells/chat:frontend'), 'shells/chat:frontend')
	assertEquals(migrateLegacySuiteKey('server/live'), 'server:live')
})

Deno.test('migrateLegacyStateSuites rewrites keys and blockedBy', () => {
	const migrated = migrateLegacyStateSuites({
		'shells/chat/frontend': makeStateEntry({
			status: 'blocked',
			blockedBy: ['server/live', 'shells/chat/pure'],
		}),
	})
	assertEquals(Object.keys(migrated), ['shells/chat:frontend'])
	assertEquals(migrated['shells/chat:frontend'].blockedBy, ['server:live', 'shells/chat:pure'])
})

Deno.test('judgeSuite elevates suite-level failed over green/noisy subtests', () => {
	const suite = makeSuite('shells/chat', 'frontend', {
		subtests: [
			{ name: 'smoke', triggers: ['src/a.spec.mjs'] },
			{ name: 'hub', triggers: ['src/b.spec.mjs'] },
		],
	})
	const entry = makeStateEntry({
		status: 'failed',
		subtests: {
			smoke: {
				status: 'passed',
				commitHash: 'abc',
				uncommittedHash: null,
				triggerHash: null,
				durationMs: 1,
				baselineDurationMs: 1,
				failedFiles: [],
				noiseHits: [],
			},
			hub: {
				status: 'noisy',
				commitHash: 'abc',
				uncommittedHash: null,
				triggerHash: null,
				durationMs: 1,
				baselineDurationMs: 1,
				failedFiles: [],
				noiseHits: ['browser_network'],
			},
		},
	})
	const verdict = judgeSuite(suite, entry, [], new Map())
	assertEquals(verdict.kind, 'red')
	assertEquals(verdict.fresh, true)
	assertEquals(verdict.subtestsToRun, [])
})

Deno.test('goalImperfectKeys keeps failed even if verdict misclassified green', () => {
	const state = {
		suites: {
			'shells/chat:frontend': makeStateEntry({ status: 'failed' }),
			'shells/chat:pure': makeStateEntry({ status: 'passed' }),
		},
	}
	const verdicts = new Map([
		['shells/chat:frontend', { kind: 'green', fresh: true, triggerHash: null }],
		['shells/chat:pure', { kind: 'green', fresh: true, triggerHash: null }],
	])
	assertEquals([...goalImperfectKeys(verdicts, state)], ['shells/chat:frontend'])
})
