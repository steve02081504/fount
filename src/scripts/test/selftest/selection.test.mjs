/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { buildPlan } from '../core/plan.mjs'
import { resolveSelector } from '../core/selector.mjs'
import { collectStaleTriggerEvidence, migrateLegacySuiteKey, migrateLegacyStateSuites, suiteKey } from '../core/state.mjs'
import { buildVerdicts, judgeSuite } from '../core/verdict.mjs'
import {
	goalContinue,
	goalExplicit,
	goalImperfectKeys,
	goalOutdated,
	selectDefaultWave,
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

Deno.test('selectDefaultWave includes failed and locale-stale together', () => {
	const all = [
		makeSuite('shells/social', 'pure', { triggers: ['src/public/parts/shells/social/test/pure/**'] }),
		makeSuite('checks', 'i18n_keys', { triggers: ['src/public/locales/*.json'] }),
		makeSuite('shells/config', 'frontend', {
			triggers: ['src/public/parts/shells/config/public/**'],
			subtests: [
				{ name: 'smoke', spec: 'smoke.spec.mjs', triggers: ['src/public/parts/shells/config/test/frontend/smoke.spec.mjs'] },
				{ name: 'jsonEditor', spec: 'jsonEditor.spec.mjs', triggers: ['src/public/locales/**'] },
			],
		}),
	]
	const localeFile = 'src/public/locales/zh-CN.json'
	const state = {
		suites: {
			'shells/social:pure': makeStateEntry({ status: 'failed', triggerHash: 'keep' }),
			'checks:i18n_keys': makeStateEntry({ status: 'passed', triggerHash: 'old' }),
			'shells/config:frontend': makeStateEntry({
				status: 'passed',
				triggerHash: 'old',
				subtests: {
					smoke: { status: 'passed', commitHash: 'abc', uncommittedHash: null, ranAt: '', durationMs: 1, triggerHash: 'old' },
					jsonEditor: { status: 'passed', commitHash: 'abc', uncommittedHash: null, ranAt: '', durationMs: 1, triggerHash: 'old' },
				},
			}),
		},
	}
	const uncommittedHashes = new Map([[localeFile, 'digest']])
	const committedChangedByKey = new Map([
		['shells/social:pure', []],
		['checks:i18n_keys', []],
		['shells/config:frontend', []],
		['shells/config:frontend#smoke', []],
		['shells/config:frontend#jsonEditor', []],
	])
	const verdicts = buildVerdicts(all, state, committedChangedByKey, uncommittedHashes)
	assertEquals(verdicts.get('shells/social:pure')?.kind, 'red')
	assertEquals(verdicts.get('checks:i18n_keys')?.kind, 'unknown')
	assertEquals(verdicts.get('shells/config:frontend')?.kind, 'unknown')
	assertEquals(verdicts.get('shells/config:frontend')?.subtestsToRun, ['jsonEditor'])

	const selection = selectDefaultWave({
		verdicts,
		state,
		allSuites: all,
		scope: all,
		committedChangedByKey,
		uncommittedFiles: [localeFile],
		commitHash: 'abc',
		uncommittedHash: 'u',
	})
	assertEquals(selection.action, 'run')
	assertEquals([...selection.goalKeys].sort(), [
		'checks:i18n_keys',
		'shells/config:frontend',
		'shells/social:pure',
	])
	assertEquals(selection.goalEvidenceByKey.get('shells/social:pure')?.kind, 'imperfect_failed')
	assertEquals(selection.goalEvidenceByKey.get('checks:i18n_keys')?.kind, 'stale_content')
	assertEquals(selection.goalEvidenceByKey.get('checks:i18n_keys')?.matchedPaths, [localeFile])

	const byKey = new Map(all.map(s => [suiteKey(s.manifestId, s.name), s]))
	const plan = buildPlan(selection.goalKeys, verdicts, byKey, all, selection.goalEvidenceByKey)
	assertEquals(plan.slots.find(slot => slot.key === 'shells/config:frontend')?.subtestsToRun, ['jsonEditor'])
	assertEquals(plan.slots.filter(slot => slot.action === 'run').map(slot => slot.key).sort(), [
		'checks:i18n_keys',
		'shells/config:frontend',
		'shells/social:pure',
	])
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

const SKIP_BECAUSE = [{ url: 'https://github.com/homebridge/ciao/issues/72', delayMs: 0 }]

Deno.test('skip_because leftover failed is not imperfect and does not expand dependents', () => {
	const all = [
		makeSuite('server', 'live', { skipBecause: SKIP_BECAUSE }),
		makeSuite('shells/home', 'frontend', { dependsOn: ['server:live'] }),
		makeSuite('shells/chat', 'integration', { dependsOn: ['server:live'] }),
	]
	const state = {
		suites: {
			'server:live': makeStateEntry({ status: 'failed' }),
			'shells/home:frontend': makeStateEntry({ status: 'passed' }),
			'shells/chat:integration': makeStateEntry({
				status: 'blocked',
				blockedBy: ['server:live'],
			}),
		},
	}
	const committedChangedByKey = new Map(all.map(s => [suiteKey(s.manifestId, s.name), []]))
	const verdicts = buildVerdicts(all, state, committedChangedByKey, new Map())
	assertEquals([...goalImperfectKeys(verdicts, state, all)], [])
	assertEquals([...goalContinue(verdicts, state, all)], [])
	const selection = selectDefaultWave({
		verdicts,
		state,
		allSuites: all,
		scope: all,
		committedChangedByKey,
		commitHash: 'abc',
		uncommittedHash: null,
	})
	assertEquals(selection.action, 'exit')
})

Deno.test('skip_tree leftover failed omits stale and blocked descendants', () => {
	const skipTree = [{ url: 'https://github.com/homebridge/ciao/issues/72', delayMs: 0, as: 'skip_tree' }]
	const all = [
		makeSuite('server', 'live', { skipBecause: skipTree }),
		makeSuite('shells/home', 'frontend', { dependsOn: ['server:live'] }),
		makeSuite('shells/chat', 'integration', { dependsOn: ['server:live'] }),
	]
	const state = {
		suites: {
			'server:live': makeStateEntry({ status: 'failed' }),
			'shells/home:frontend': makeStateEntry({ status: 'passed' }),
			'shells/chat:integration': makeStateEntry({
				status: 'blocked',
				blockedBy: ['server:live'],
			}),
		},
	}
	const committedChangedByKey = new Map(all.map(s => [suiteKey(s.manifestId, s.name), []]))
	const verdicts = buildVerdicts(all, state, committedChangedByKey, new Map())
	assertEquals([...goalImperfectKeys(verdicts, state, all)], [])
	assertEquals([...goalContinue(verdicts, state, all)], [])
	const selection = selectDefaultWave({
		verdicts,
		state,
		allSuites: all,
		scope: all,
		committedChangedByKey,
		commitHash: 'abc',
		uncommittedHash: null,
	})
	assertEquals(selection.action, 'exit')
})

Deno.test('imperfect_dependent below a failed upstream must run, not reuse', () => {
	const all = [
		makeSuite('shells/chat', 'fed_core'),
		makeSuite('shells/chat', 'fed_ban', { dependsOn: ['fed_core'] }),
	]
	const state = {
		suites: {
			'shells/chat:fed_core': makeStateEntry({ status: 'failed' }),
			'shells/chat:fed_ban': makeStateEntry({ status: 'passed' }),
		},
	}
	const committedChangedByKey = new Map(all.map(s => [suiteKey(s.manifestId, s.name), []]))
	const verdicts = buildVerdicts(all, state, committedChangedByKey, new Map())
	assertEquals(verdicts.get('shells/chat:fed_core')?.kind, 'red')
	assertEquals(verdicts.get('shells/chat:fed_ban')?.kind, 'green')

	const selection = selectImperfectWave({
		verdicts,
		state,
		allSuites: all,
		scope: all,
		commitHash: 'abc',
		uncommittedHash: null,
	})
	assertEquals([...selection.goalKeys].sort(), ['shells/chat:fed_ban', 'shells/chat:fed_core'])
	assertEquals(selection.goalEvidenceByKey.get('shells/chat:fed_ban')?.kind, 'imperfect_dependent')

	const byKey = new Map(all.map(s => [suiteKey(s.manifestId, s.name), s]))
	const plan = buildPlan(selection.goalKeys, verdicts, byKey, all, selection.goalEvidenceByKey)
	const fedBan = plan.slots.find(slot => slot.key === 'shells/chat:fed_ban')
	// 上层失败的一层下游：不得因未改动而 reuse，必须 run（由运行时决定是否真跑或被 blocked）
	assertEquals(fedBan?.action, 'run')
})
