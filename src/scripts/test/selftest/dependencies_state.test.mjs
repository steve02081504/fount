/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	detectDependencyCycle,
	expandImperfectDependents,
	resolveSuiteDependencies,
	sortManifestIds,
	topoSortSuites,
} from '../core/dependencies.mjs'
import { listManifestIds, loadAllSuites } from '../core/manifest.mjs'
import { buildPlan } from '../core/plan.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import { refreshEntryFingerprint, suiteKey } from '../core/state.mjs'
import {
	buildVerdicts,
	isContentFresh,
	isTriggerHashStale,
	judgeSuite,
	verdictAllowsDownstream,
	verdictReusable,
} from '../core/verdict.mjs'

import { makeStateEntry, makeSuite } from './fixtures.mjs'

Deno.test('resolveSuiteDependencies expands manifest selector', () => {
	const all = [
		makeSuite('server', 'live'),
		makeSuite('shells/chat', 'integration', { dependsOn: ['server:live'] }),
	]
	const deps = resolveSuiteDependencies(all[1], all)
	assertEquals(deps, [{ manifestId: 'server', name: 'live' }])
})

Deno.test('topoSortSuites orders dependencies first', () => {
	const all = [
		makeSuite('server', 'live'),
		makeSuite('shells/chat', 'integration', { dependsOn: ['server:live'] }),
	]
	assertEquals(
		topoSortSuites(all).map(s => suiteKey(s.manifestId, s.name)),
		['server:live', 'shells/chat:integration'],
	)
})

Deno.test('sortManifestIds orders dependency before dependent', () => {
	const all = [
		makeSuite('server', 'live'),
		makeSuite('shells/chat', 'integration', { dependsOn: ['server:live'] }),
		makeSuite('shells/social', 'pure'),
	]
	assertEquals(
		sortManifestIds(['shells/chat', 'shells/social', 'server'], all),
		['shells/social', 'server', 'shells/chat'],
	)
})

Deno.test('detectDependencyCycle reports cycle', () => {
	const a = makeSuite('a', 'one', { dependsOn: ['b:two'] })
	const b = makeSuite('b', 'two', { dependsOn: ['a:one'] })
	assertEquals(detectDependencyCycle([a, b]), 'a:one -> b:two -> a:one')
})

Deno.test('listManifestIds uses dependency-aware order', async () => {
	const all = await loadAllSuites(REPO_ROOT)
	const ids = listManifestIds(all)
	assertEquals(ids.includes('server') && ids.includes('shells/chat'), true)
	assertEquals(ids.indexOf('server') < ids.indexOf('shells/chat'), true)
})

Deno.test('isContentFresh ignores non-trigger paths', () => {
	const s = makeSuite('server', 'live')
	const entry = makeStateEntry()
	assertEquals(isContentFresh(s, entry, ['README.md'], null), true)
	assertEquals(isContentFresh(s, entry, ['src/server/foo.mjs'], null), false)
	assertEquals(isContentFresh(s, undefined, [], null), false)
})

Deno.test('judgeSuite maps fresh results to green/noisy/red', () => {
	const s = makeSuite('server', 'live')
	assertEquals(judgeSuite(s, makeStateEntry(), [], new Map()).kind, 'green')
	assertEquals(judgeSuite(s, makeStateEntry({ status: 'noisy' }), [], new Map()).kind, 'noisy')
	assertEquals(judgeSuite(s, makeStateEntry({ status: 'failed' }), [], new Map()).kind, 'red')
	assertEquals(judgeSuite(s, makeStateEntry(), ['src/server/x.mjs'], new Map()).kind, 'unknown')
})

Deno.test('verdictReusable accepts fresh real results unless force', () => {
	const green = judgeSuite(makeSuite('a', 'x'), makeStateEntry(), [], new Map())
	assertEquals(verdictReusable(green, false), true)
	assertEquals(verdictReusable(green, true), false)
	assertEquals(verdictReusable(judgeSuite(makeSuite('a', 'x'), undefined, [], new Map()), false), false)
})

Deno.test('buildPlan reuses fresh upstream and does not block downstream', () => {
	const all = [
		makeSuite('server', 'live'),
		makeSuite('shells/chat', 'frontend', { dependsOn: ['server:live'] }),
	]
	const byKey = new Map(all.map(s => [suiteKey(s.manifestId, s.name), s]))
	const state = { suites: { 'server:live': makeStateEntry() } }
	const committed = new Map(all.map(s => [suiteKey(s.manifestId, s.name), []]))
	const verdicts = buildVerdicts(all, state, committed, new Map())
	const plan = buildPlan(new Set(['shells/chat:frontend']), verdicts, byKey, all)
	assertEquals(plan.slots.map(s => [s.key, s.action]), [
		['shells/chat:frontend', 'run'],
	])
})

Deno.test('buildPlan blocks downstream when reused upstream failed', () => {
	const all = [
		makeSuite('server', 'live'),
		makeSuite('shells/chat', 'frontend', { dependsOn: ['server:live'] }),
	]
	const byKey = new Map(all.map(s => [suiteKey(s.manifestId, s.name), s]))
	const state = { suites: { 'server:live': { ...makeStateEntry(), status: 'failed' } } }
	const verdicts = buildVerdicts(all, state, new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])), new Map())
	const plan = buildPlan(new Set(['shells/chat:frontend']), verdicts, byKey, all)
	assertEquals(plan.slots.find(s => s.key === 'shells/chat:frontend')?.action, 'blocked')
})

Deno.test('buildPlan pulls unsatisfied upstream into plan', () => {
	const all = [
		makeSuite('shells/chat', 'pure'),
		makeSuite('shells/social', 'cross_shell_emoji', { dependsOn: ['shells/chat:pure'] }),
	]
	const byKey = new Map(all.map(s => [suiteKey(s.manifestId, s.name), s]))
	const verdicts = buildVerdicts(all, { suites: {} }, new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])), new Map())
	const plan = buildPlan(new Set(['shells/social:cross_shell_emoji']), verdicts, byKey, all)
	assertEquals(plan.slots.map(s => s.key), ['shells/chat:pure', 'shells/social:cross_shell_emoji'])
	assertEquals(plan.slots.map(s => s.action), ['run', 'run'])
})

Deno.test('expandImperfectDependents adds one downstream level', () => {
	const all = [
		makeSuite('shells/chat', 'parent'),
		makeSuite('shells/chat', 'child', { dependsOn: ['parent'] }),
		makeSuite('shells/chat', 'grandchild', { dependsOn: ['child'] }),
	]
	const imperfect = new Set(['shells/chat:parent'])
	const expanded = expandImperfectDependents(imperfect, all)
	assertEquals([...expanded].sort(), ['shells/chat:child', 'shells/chat:parent'])
})

Deno.test('serial.mjs change stales pure but not live when triggers partitioned', () => {
	const pure = makeSuite('shells/chat', 'pure', {
		triggers: [
			'src/scripts/test/deno/serial.mjs',
			'src/public/parts/shells/chat/test/pure/**',
		],
	})
	const live = makeSuite('shells/chat', 'smoke_chat', {
		triggers: [
			'src/public/parts/shells/chat/test/live/run.mjs',
			'src/public/parts/shells/chat/test/live/scripts/smoke_chat.mjs',
		],
	})
	const entry = makeStateEntry()
	const changed = ['src/scripts/test/deno/serial.mjs']
	assertEquals(isContentFresh(pure, entry, changed, null), false)
	assertEquals(isContentFresh(live, entry, changed, null), true)
})

Deno.test('verdictAllowsDownstream accepts green and noisy only', () => {
	assertEquals(verdictAllowsDownstream({ kind: 'green', fresh: true, triggerHash: null }), true)
	assertEquals(verdictAllowsDownstream({ kind: 'noisy', fresh: true, triggerHash: null }), true)
	assertEquals(verdictAllowsDownstream({ kind: 'red', fresh: true, triggerHash: null }), false)
	assertEquals(verdictAllowsDownstream({ kind: 'unknown', fresh: false, triggerHash: null }), false)
})

Deno.test('isTriggerHashStale ignores dirty-to-clean drift', () => {
	assertEquals(isTriggerHashStale('old', null), false)
	assertEquals(isTriggerHashStale(null, null), false)
	assertEquals(isTriggerHashStale('a', 'a'), false)
	assertEquals(isTriggerHashStale(null, 'new'), true)
	assertEquals(isTriggerHashStale('a', 'b'), true)
})

Deno.test('refreshEntryFingerprint aligns subtest fingerprints', () => {
	const state = {
		suites: {
			'shells/chat:frontend': makeStateEntry({
				commitHash: 'old',
				triggerHash: 'suite-old',
				subtests: {
					smoke: {
						status: 'passed',
						commitHash: 'old',
						uncommittedHash: 'dirty',
						triggerHash: 'sub-old',
						durationMs: 1,
						baselineDurationMs: 1,
						failedFiles: [],
						noiseHits: [],
					},
				},
			}),
		},
	}
	refreshEntryFingerprint(state, 'shells/chat:frontend', 'head', null, 'suite-new', { smoke: 'sub-new' })
	const entry = state.suites['shells/chat:frontend']
	assertEquals(entry.commitHash, 'head')
	assertEquals(entry.triggerHash, 'suite-new')
	assertEquals(entry.uncommittedHash, null)
	assertEquals(entry.subtests.smoke.commitHash, 'head')
	assertEquals(entry.subtests.smoke.triggerHash, 'sub-new')
	assertEquals(entry.subtests.smoke.uncommittedHash, null)
})

Deno.test('fresh green stays reusable with old commitHash without pre-align', () => {
	// HEAD 已前进但 trigger 未命中时，不必在波次开始前批量推进 commitHash；
	// Ctrl+C 不应把未处理套件写成「已在当前 HEAD 验证」。
	const suite = makeSuite('shells/chat', 'pure', { triggers: ['src/public/parts/shells/chat/test/pure/**'] })
	const entry = makeStateEntry({ commitHash: 'old', triggerHash: null })
	const verdict = judgeSuite(suite, entry, [], new Map())
	assertEquals(verdict.kind, 'green')
	assertEquals(verdict.fresh, true)
	assertEquals(verdictReusable(verdict, false), true)
	assertEquals(entry.commitHash, 'old')
})
