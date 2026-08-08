/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { findDeadTriggers, triggerPatternMatchesAny } from '../core/trigger_audit.mjs'

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

Deno.test('findDeadTriggers reports suite-level dead triggers', () => {
	const suite = makeSuite('shells/chat', 'pure', {
		triggers: ['src/public/parts/shells/chat/**', 'src/no/such/tree/**'],
	})
	assertEquals(findDeadTriggers([suite], REPO_FILES), [{
		manifestId: 'shells/chat',
		suiteName: 'pure',
		pattern: 'src/no/such/tree/**',
	}])
})

Deno.test('findDeadTriggers reports subtest-level dead triggers', () => {
	const suite = {
		...makeSuite('shells/social', 'frontend', { triggers: [] }),
		subtests: [{
			name: 'feed',
			spec: 'feed.spec.mjs',
			triggers: ['src/public/parts/shells/chat/src/foo.mjs', 'src/dead/feed.mjs'],
		}],
	}
	assertEquals(findDeadTriggers([suite], REPO_FILES), [{
		manifestId: 'shells/social',
		suiteName: 'frontend',
		subtestName: 'feed',
		pattern: 'src/dead/feed.mjs',
	}])
})

Deno.test('findDeadTriggers skips patterns shared with a matching scope', () => {
	const suite = makeSuite('testkit', 'state', {
		triggers: ['src/scripts/test/core/state.mjs'],
	})
	assertEquals(findDeadTriggers([suite], REPO_FILES), [])
})
