/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { buildPlan } from '../core/plan.mjs'
import { resolveSelector } from '../core/selector.mjs'
import { suiteKey } from '../core/state.mjs'
import { buildVerdicts } from '../core/verdict.mjs'
import { buildReasonsFromPlan } from '../runner/continue_reason.mjs'
import { goalContinue, goalDiff } from '../runner/selection.mjs'

import { makeSuite } from './fixtures.mjs'

Deno.test('resolveSelector accepts colon and slash forms', () => {
	const known = ['server', 'shells/chat']
	assertEquals(resolveSelector('server:live', known), { manifestId: 'server', suiteSelectors: ['live'] })
	assertEquals(resolveSelector('server/live', known), { manifestId: 'server', suiteSelectors: ['live'] })
	assertEquals(resolveSelector('shells/chat/fed_core', known), { manifestId: 'shells/chat', suiteSelectors: ['fed_core'] })
	assertEquals(resolveSelector('server', known), { manifestId: 'server', suiteSelectors: [] })
})

Deno.test('goalContinue selects non-green verdicts', () => {
	const verdicts = new Map([
		['a/x', { kind: 'green', fresh: true, triggerHash: null }],
		['b/y', { kind: 'red', fresh: true, triggerHash: null }],
		['c/z', { kind: 'unknown', fresh: false, triggerHash: null }],
	])
	assertEquals([...goalContinue(verdicts)].sort(), ['b/y', 'c/z'])
})

Deno.test('goalDiff expands one downstream level', () => {
	const all = [
		makeSuite('shells/chat', 'parent'),
		makeSuite('shells/chat', 'child', { dependsOn: ['parent'] }),
	]
	const { goalKeys } = goalDiff(['src/shells/chat/parent.mjs'], all, all, 'head', null)
	assertEquals([...goalKeys].sort(), ['shells/chat/child', 'shells/chat/parent'])
})

Deno.test('buildReasonsFromPlan stamps goal and dependency reasons', () => {
	const all = [
		makeSuite('server', 'live'),
		makeSuite('shells/chat', 'frontend', { dependsOn: ['server:live'] }),
	]
	const byKey = new Map(all.map(s => [suiteKey(s.manifestId, s.name), s]))
	const verdicts = buildVerdicts(all, { suites: {} }, new Map(all.map(s => [suiteKey(s.manifestId, s.name), []])), new Map())
	const evidence = new Map([['shells/chat/frontend', { kind: 'explicit_selected' }]])
	const plan = buildPlan(new Set(['shells/chat/frontend']), verdicts, byKey, all, evidence)
	const reasons = buildReasonsFromPlan(plan)
	assertEquals(reasons.get('shells/chat/frontend')?.kind, 'explicit_selected')
	assertEquals(reasons.get('server/live')?.kind, 'dependency_required')
})
