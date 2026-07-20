/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { findDeadTriggerWarnings, triggerPatternMatchesAny } from '../core/trigger_audit.mjs'

import { makeSuite } from './fixtures.mjs'

const REPO_FILES = [
	'src/scripts/test/core/state.mjs',
	'src/public/parts/shells/chat/src/foo.mjs',
]

Deno.test('triggerPatternMatchesAny matches exact path and glob', () => {
	assertEquals(triggerPatternMatchesAny('src/scripts/test/core/state.mjs', REPO_FILES), true)
	assertEquals(triggerPatternMatchesAny('src/public/parts/shells/chat/**', REPO_FILES), true)
	assertEquals(triggerPatternMatchesAny('src/missing/**', REPO_FILES), false)
})

Deno.test('findDeadTriggerWarnings reports suite-level dead triggers', () => {
	const suite = makeSuite('shells/chat', 'pure', {
		triggers: ['src/public/parts/shells/chat/**', 'src/no/such/tree/**'],
	})
	const warnings = findDeadTriggerWarnings([suite], REPO_FILES)
	assertEquals(warnings, [{
		manifestId: 'shells/chat',
		suiteName: 'pure',
		pattern: 'src/no/such/tree/**',
	}])
})

Deno.test('findDeadTriggerWarnings reports subtest-level dead triggers', () => {
	const suite = {
		...makeSuite('shells/social', 'frontend', { triggers: [] }),
		subtests: [{
			name: 'feed',
			spec: 'feed.spec.mjs',
			triggers: ['src/public/parts/shells/chat/src/foo.mjs', 'src/dead/feed.mjs'],
		}],
	}
	const warnings = findDeadTriggerWarnings([suite], REPO_FILES)
	assertEquals(warnings, [{
		manifestId: 'shells/social',
		suiteName: 'frontend',
		subtestName: 'feed',
		pattern: 'src/dead/feed.mjs',
	}])
})

Deno.test('findDeadTriggerWarnings skips patterns shared with a matching scope', () => {
	const suite = makeSuite('testkit', 'state', {
		triggers: ['src/scripts/test/core/state.mjs'],
	})
	assertEquals(findDeadTriggerWarnings([suite], REPO_FILES), [])
})
