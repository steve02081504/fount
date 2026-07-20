/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { orderFailedFirst, readTimingsOutFile, writeTimingsOutFile } from '../core/protocol.mjs'
import { aggregateSubtestVerdicts, judgeSubtest } from '../core/verdict.mjs'
import { subtestMatchesSpec } from '../playwright/phases.mjs'
import { mapTimingsToSubtests } from '../runner/suite_run.mjs'

import { makeSuite } from './fixtures.mjs'

Deno.test('orderFailedFirst puts listed paths first and keeps relative order', () => {
	const files = ['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs']
	const { first, rest, ordered } = orderFailedFirst(files, ['c.mjs', 'a.mjs'])
	assertEquals(first, ['a.mjs', 'c.mjs'])
	assertEquals(rest, ['b.mjs', 'd.mjs'])
	assertEquals(ordered, ['a.mjs', 'c.mjs', 'b.mjs', 'd.mjs'])
})

Deno.test('orderFailedFirst with empty first list keeps original', () => {
	const files = ['a.mjs', 'b.mjs']
	assertEquals(orderFailedFirst(files, []).ordered, files)
})

Deno.test('subtestMatchesSpec accepts name or basename', () => {
	assertEquals(subtestMatchesSpec('feed', 'feed.spec.mjs'), true)
	assertEquals(subtestMatchesSpec('feed.spec.mjs', 'feed.spec.mjs'), true)
	assertEquals(subtestMatchesSpec('profile', 'feed.spec.mjs'), false)
})

Deno.test('aggregateSubtestVerdicts prioritizes unknown over red', () => {
	const aggregated = aggregateSubtestVerdicts({
		a: { kind: 'red', fresh: true, triggerHash: 'x' },
		b: { kind: 'unknown', fresh: false, triggerHash: 'y' },
		c: { kind: 'green', fresh: true, triggerHash: 'z' },
	}, 'shared')
	assertEquals(aggregated.kind, 'unknown')
	assertEquals(aggregated.subtestsToRun.sort(), ['a', 'b'])
	assertEquals(aggregated.triggerHash, 'shared')
})

Deno.test('judgeSubtest marks missing entry unknown', () => {
	const suite = makeSuite('shells/social', 'frontend', {
		triggers: ['src/shared.mjs'],
		subtests: [{ name: 'feed', spec: 'feed.spec.mjs', triggers: ['src/feed.mjs'] }],
	})
	const verdict = judgeSubtest(suite, suite.subtests[0], undefined, false, [], new Map())
	assertEquals(verdict.kind, 'unknown')
})

Deno.test('writeTimingsOutFile / readTimingsOutFile round-trip', async () => {
	const path = await Deno.makeTempFile({ prefix: 'fount-timings-', suffix: '.json' })
	try {
		await writeTimingsOutFile(path, {
			'src/a/feed.spec.mjs': 1234.5,
			'src/a\\profile.spec.mjs': 50,
			bad: -1,
		})
		assertEquals(await readTimingsOutFile(path), {
			'src/a/feed.spec.mjs': 1234.5,
			'src/a/profile.spec.mjs': 50,
		})
		assertEquals(await readTimingsOutFile(`${path}.missing`), {})
	}
	finally {
		await Deno.remove(path)
	}
})

Deno.test('mapTimingsToSubtests matches by spec basename', () => {
	const suite = makeSuite('shells/social', 'frontend', {
		subtests: [
			{ name: 'feed', spec: 'feed.spec.mjs', triggers: [] },
			{ name: 'profile', spec: 'profile.spec.mjs', triggers: [] },
		],
	})
	assertEquals(mapTimingsToSubtests(suite, {
		'src/public/parts/shells/social/test/frontend/feed.spec.mjs': 2000,
		'src/public/parts/shells/social/test/frontend/profile.spec.mjs': 3000,
	}, ['feed']), { feed: 2000 })
})
