/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	detectDependencyCycle,
	expandDiffDependents,
	expandImperfectDependents,
	resolveSuiteDependencies,
	sortManifestIds,
	topoSortSuites,
} from '../core/dependencies.mjs'
import { listManifestIds, loadAllSuites } from '../core/manifest.mjs'
import { buildPlan } from '../core/plan.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import { suiteKey } from '../core/state.mjs'
import {
	buildVerdicts,
	isContentFresh,
	judgeSuite,
	verdictAllowsDownstream,
	verdictReusable,
} from '../core/verdict.mjs'

import { makeStateEntry, makeSuite } from './fixtures.mjs'

Deno.test('resolveSuiteDependencies expands manifest selector', () => {
	const all = [
		makeSuite('p2p', 'sim'),
		makeSuite('shells/chat', 'fed_core', { dependsOn: ['p2p:sim'] }),
	]
	const deps = resolveSuiteDependencies(all[1], all)
	assertEquals(deps, [{ manifestId: 'p2p', name: 'sim' }])
})

Deno.test('topoSortSuites orders dependencies first', () => {
	const all = [
		makeSuite('p2p', 'sim'),
		makeSuite('shells/chat', 'fed_core', { dependsOn: ['p2p:sim'] }),
	]
	assertEquals(
		topoSortSuites(all).map(s => suiteKey(s.manifestId, s.name)),
		['p2p/sim', 'shells/chat/fed_core'],
	)
})

Deno.test('sortManifestIds orders dependency before dependent', () => {
	const all = [
		makeSuite('p2p', 'sim'),
		makeSuite('shells/chat', 'fed_core', { dependsOn: ['p2p:sim'] }),
		makeSuite('server', 'live'),
	]
	assertEquals(
		sortManifestIds(['shells/chat', 'p2p', 'server'], all),
		['server', 'p2p', 'shells/chat'],
	)
})

Deno.test('detectDependencyCycle reports cycle', () => {
	const a = makeSuite('a', 'one', { dependsOn: ['b:two'] })
	const b = makeSuite('b', 'two', { dependsOn: ['a:one'] })
	assertEquals(detectDependencyCycle([a, b]), 'a/one -> b/two -> a/one')
})

Deno.test('listManifestIds uses dependency-aware order', async () => {
	const all = await loadAllSuites(REPO_ROOT)
	const ids = listManifestIds(all)
	assertEquals(ids.includes('p2p') && ids.includes('shells/chat'), true)
	assertEquals(ids.indexOf('p2p') < ids.indexOf('shells/chat'), true)
})

Deno.test('isContentFresh ignores non-trigger paths', () => {
	const s = makeSuite('server', 'live')
	const entry = makeStateEntry()
	assertEquals(isContentFresh(s, entry, ['README.md'], new Map()), true)
	assertEquals(isContentFresh(s, entry, ['src/server/foo.mjs'], new Map()), false)
	assertEquals(isContentFresh(s, undefined, [], new Map()), false)
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
	const state = { suites: { 'server/live': makeStateEntry() } }
	const committed = new Map(all.map(s => [suiteKey(s.manifestId, s.name), []]))
	const verdicts = buildVerdicts(all, state, committed, new Map())
	const plan = buildPlan(new Set(['shells/chat/frontend']), verdicts, byKey, all)
	assertEquals(plan.slots.map(s => [s.key, s.action]), [
		['shells/chat/frontend', 'run'],
	])
})

Deno.test('buildPlan blocks downstream when reused upstream failed', () => {
	const all = [
		makeSuite('server', 'live'),
		makeSuite('shells/chat', 'frontend', { dependsOn: ['server:live'] }),
	]
	const byKey = new Map(all.map(s => [suiteKey(s.manifestId, s.name), s]))
	const state = { suites: { 'server/live': { ...makeStateEntry(), status: 'failed' } } }
	const verdicts = buildVerdicts(all, state, new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])), new Map())
	const plan = buildPlan(new Set(['shells/chat/frontend']), verdicts, byKey, all)
	assertEquals(plan.slots.find(s => s.key === 'shells/chat/frontend')?.action, 'blocked')
})

Deno.test('buildPlan pulls unsatisfied upstream into plan', () => {
	const all = [
		makeSuite('shells/chat', 'pure'),
		makeSuite('shells/social', 'cross_shell_emoji', { dependsOn: ['shells/chat:pure'] }),
	]
	const byKey = new Map(all.map(s => [suiteKey(s.manifestId, s.name), s]))
	const verdicts = buildVerdicts(all, { suites: {} }, new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])), new Map())
	const plan = buildPlan(new Set(['shells/social/cross_shell_emoji']), verdicts, byKey, all)
	assertEquals(plan.slots.map(s => s.key), ['shells/chat/pure', 'shells/social/cross_shell_emoji'])
	assertEquals(plan.slots.map(s => s.action), ['run', 'run'])
})

Deno.test('expandImperfectDependents adds one downstream level', () => {
	const all = [
		makeSuite('shells/chat', 'parent'),
		makeSuite('shells/chat', 'child', { dependsOn: ['parent'] }),
		makeSuite('shells/chat', 'grandchild', { dependsOn: ['child'] }),
	]
	const imperfect = new Set(['shells/chat/parent'])
	const expanded = expandImperfectDependents(imperfect, all)
	assertEquals([...expanded].sort(), ['shells/chat/child', 'shells/chat/parent'])
})

Deno.test('expandDiffDependents adds one downstream level', () => {
	const all = [
		makeSuite('shells/chat', 'parent'),
		makeSuite('shells/chat', 'child', { dependsOn: ['parent'] }),
		makeSuite('shells/chat', 'grandchild', { dependsOn: ['child'] }),
	]
	const hit = new Set(['shells/chat/parent'])
	const expanded = expandDiffDependents(hit, all)
	assertEquals([...expanded].sort(), ['shells/chat/child', 'shells/chat/parent'])
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
	assertEquals(isContentFresh(pure, entry, changed, new Map()), false)
	assertEquals(isContentFresh(live, entry, changed, new Map()), true)
})

Deno.test('verdictAllowsDownstream accepts green and noisy only', () => {
	assertEquals(verdictAllowsDownstream({ kind: 'green', fresh: true, triggerHash: null }), true)
	assertEquals(verdictAllowsDownstream({ kind: 'noisy', fresh: true, triggerHash: null }), true)
	assertEquals(verdictAllowsDownstream({ kind: 'red', fresh: true, triggerHash: null }), false)
	assertEquals(verdictAllowsDownstream({ kind: 'unknown', fresh: false, triggerHash: null }), false)
})
