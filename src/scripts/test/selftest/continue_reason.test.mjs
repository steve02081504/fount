/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { buildPlan } from '../core/plan.mjs'
import { resolveSelector } from '../core/selector.mjs'
import { suiteKey } from '../core/state.mjs'
import { buildVerdicts } from '../core/verdict.mjs'
import { buildReasonsFromPlan } from '../runner/continue_reason.mjs'
import { goalContinue, goalImperfectKeys } from '../runner/selection.mjs'

import { makeStateEntry, makeSuite } from './fixtures.mjs'

Deno.test('resolveSelector accepts colon and slash forms with optional subtest', () => {
	const known = ['server', 'shells/chat']
	assertEquals(resolveSelector('server:live', known), {
		manifestId: 'server',
		suiteSelectors: ['live'],
		subtestSelectors: {},
	})
	assertEquals(resolveSelector('server/live', known), {
		manifestId: 'server',
		suiteSelectors: ['live'],
		subtestSelectors: {},
	})
	assertEquals(resolveSelector('shells/chat/fed_core', known), {
		manifestId: 'shells/chat',
		suiteSelectors: ['fed_core'],
		subtestSelectors: {},
	})
	assertEquals(resolveSelector('server', known), {
		manifestId: 'server',
		suiteSelectors: [],
		subtestSelectors: {},
	})
	assertEquals(resolveSelector('shells/chat:frontend:feed', known), {
		manifestId: 'shells/chat',
		suiteSelectors: ['frontend'],
		subtestSelectors: { frontend: ['feed'] },
	})
	assertEquals(resolveSelector('shells/chat/frontend/feed', known), {
		manifestId: 'shells/chat',
		suiteSelectors: ['frontend'],
		subtestSelectors: { frontend: ['feed'] },
	})
	assertEquals(resolveSelector('shells/chat:pure:a,b,c', known), {
		manifestId: 'shells/chat',
		suiteSelectors: ['pure'],
		subtestSelectors: { pure: ['a', 'b', 'c'] },
	})
	assertEquals(resolveSelector('shells/chat:pure,e2e_single', known), {
		manifestId: 'shells/chat',
		suiteSelectors: ['pure', 'e2e_single'],
		subtestSelectors: {},
	})
})

Deno.test('goalImperfectKeys skips stale passed suites', () => {
	const state = {
		suites: {
			'a/x': makeStateEntry({ status: 'passed' }),
			'b/y': makeStateEntry({ status: 'failed' }),
		},
	}
	const verdicts = new Map([
		['a/x', { kind: 'unknown', fresh: false, triggerHash: null }],
		['b/y', { kind: 'red', fresh: true, triggerHash: null }],
	])
	assertEquals([...goalImperfectKeys(verdicts, state)].sort(), ['b/y'])
})

Deno.test('goalImperfectKeys skips fresh noisy', () => {
	const state = {
		suites: {
			'a/x': makeStateEntry({ status: 'noisy' }),
			'b/y': makeStateEntry({ status: 'failed' }),
		},
	}
	const verdicts = new Map([
		['a/x', { kind: 'noisy', fresh: true, triggerHash: null }],
		['b/y', { kind: 'red', fresh: true, triggerHash: null }],
	])
	assertEquals([...goalImperfectKeys(verdicts, state)].sort(), ['b/y'])
})

Deno.test('goalContinue expands one imperfect downstream level', () => {
	const all = [
		makeSuite('shells/chat', 'parent'),
		makeSuite('shells/chat', 'child', { dependsOn: ['parent'] }),
	]
	const state = {
		suites: {
			'shells/chat/parent': makeStateEntry({ status: 'failed' }),
			'shells/chat/child': makeStateEntry({ status: 'passed' }),
		},
	}
	const verdicts = new Map([
		['shells/chat/parent', { kind: 'red', fresh: true, triggerHash: null }],
		['shells/chat/child', { kind: 'green', fresh: true, triggerHash: null }],
	])
	assertEquals([...goalContinue(verdicts, state, all)].sort(), ['shells/chat/child', 'shells/chat/parent'])
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
