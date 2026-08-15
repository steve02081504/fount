/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { loadAllSuites } from '../core/manifest.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import {
	findDeadTriggers,
	findLiveTestFrameworkTriggers,
	findLocaleTreeTriggers,
	isLocaleTreeTrigger,
	isTestFrameworkTrigger,
	triggerPatternMatchesAny,
} from '../core/trigger_audit.mjs'

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

Deno.test('isLocaleTreeTrigger only matches the locales directory', () => {
	assertEquals(isLocaleTreeTrigger('src/public/locales/**'), true)
	assertEquals(isLocaleTreeTrigger('src/public/locales/*.json'), true)
	assertEquals(isLocaleTreeTrigger('src/public/locales/zh-CN.json'), true)
	assertEquals(isLocaleTreeTrigger('src/public/{pages,locales}/**'), true)
	assertEquals(isLocaleTreeTrigger('src/public/**'), false)
	assertEquals(isLocaleTreeTrigger('**/*'), false)
	assertEquals(isLocaleTreeTrigger('src/public/pages/scripts/**'), false)
})

Deno.test('findLocaleTreeTriggers allows checks and flags Playwright/path', () => {
	const checks = makeSuite('checks', 'i18n_keys', { triggers: ['src/public/locales/*.json'] })
	const frontend = {
		...makeSuite('shells/home', 'frontend', { triggers: [] }),
		subtests: [{
			name: 'smoke',
			spec: 'smoke.spec.mjs',
			triggers: ['src/public/locales/**'],
		}],
	}
	assertEquals(findLocaleTreeTriggers([checks]), [])
	assertEquals(findLocaleTreeTriggers([frontend]), [{
		manifestId: 'shells/home',
		suiteName: 'frontend',
		subtestName: 'smoke',
		pattern: 'src/public/locales/**',
	}])
})

Deno.test('repo manifests keep locale JSON and live harness triggers on the right suites', async () => {
	const all = await loadAllSuites(REPO_ROOT)
	assertEquals(findLocaleTreeTriggers(all), [])
	assertEquals(findLiveTestFrameworkTriggers(all), [])
})

Deno.test('isTestFrameworkTrigger only matches src/scripts/test', () => {
	assertEquals(isTestFrameworkTrigger('src/scripts/test/node/launch.mjs'), true)
	assertEquals(isTestFrameworkTrigger('src/scripts/test/{deno/serial.mjs,node/boot.mjs}'), true)
	assertEquals(isTestFrameworkTrigger('src/scripts/{checks,test}/**'), true)
	assertEquals(isTestFrameworkTrigger('src/scripts/test/core/allowNoise.mjs'), true)
	assertEquals(isTestFrameworkTrigger('src/server/test/live/**'), false)
	assertEquals(isTestFrameworkTrigger('src/scripts/ms.mjs'), false)
})

Deno.test('findLiveTestFrameworkTriggers allows testkit and flags product live', () => {
	assertEquals(findLiveTestFrameworkTriggers([
		makeSuite('testkit', 'launch_node', { triggers: ['src/scripts/test/node/launch.mjs'] }),
	]), [])
	assertEquals(findLiveTestFrameworkTriggers([
		makeSuite('server', 'live', { triggers: ['src/server/test/live/**', 'src/scripts/test/node/launch.mjs'] }),
	]), [{
		manifestId: 'server',
		suiteName: 'live',
		pattern: 'src/scripts/test/node/launch.mjs',
	}])
})
