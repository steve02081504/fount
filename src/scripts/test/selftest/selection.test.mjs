/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { resolveSelector } from '../core/selector.mjs'
import { collectStaleTriggerEvidence } from '../core/state.mjs'
import { goalExplicit, goalOutdated, selectImperfectWave, selectOutdatedWave } from '../runner/selection.mjs'

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
	assertEquals([...goalKeys], ['server/live'])
	assertEquals(goalEvidenceByKey.get('server/live')?.kind, 'explicit_selected')
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
})

Deno.test('selectImperfectWave exits when nothing imperfect in scope', () => {
	const all = [makeSuite('shells/chat', 'pure')]
	const state = { suites: { 'shells/chat/pure': makeStateEntry({ status: 'passed' }) } }
	const verdicts = new Map([['shells/chat/pure', { kind: 'green', fresh: true, triggerHash: null }]])
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

Deno.test('goalOutdated picks unknown in scope', () => {
	const scope = [makeSuite('shells/chat', 'pure'), makeSuite('shells/chat', 'live')]
	const verdicts = new Map([
		['shells/chat/pure', { kind: 'unknown', fresh: false, triggerHash: null }],
		['shells/chat/live', { kind: 'green', fresh: true, triggerHash: null }],
	])
	assertEquals([...goalOutdated(verdicts, scope)], ['shells/chat/pure'])
})

Deno.test('selectOutdatedWave attaches stale_content evidence', () => {
	const all = [makeSuite('shells/chat', 'pure', { triggers: ['src/a.mjs'] })]
	const state = { suites: { 'shells/chat/pure': makeStateEntry({ status: 'passed', commitHash: 'old' }) } }
	const verdicts = new Map([['shells/chat/pure', { kind: 'unknown', fresh: false, triggerHash: null }]])
	const selection = selectOutdatedWave({
		verdicts,
		scope: all,
		allSuites: all,
		committedChangedByKey: new Map([['shells/chat/pure', ['src/a.mjs']]]),
		commitHash: 'new',
		uncommittedHash: null,
		state,
	})
	assertEquals(selection.action, 'run')
	assertEquals(selection.goalEvidenceByKey.get('shells/chat/pure')?.kind, 'stale_content')
})
