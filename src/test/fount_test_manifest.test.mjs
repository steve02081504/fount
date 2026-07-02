/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { filterSuites, suiteMatchesSelector } from '../scripts/test/core/manifest.mjs'

/** @type {import('../scripts/test/core/manifest.mjs').SuiteDef} */
const fedTest = {
	manifestId: 'shells/chat',
	name: 'fed_test',
	id: 'fed_test',
	run: [],
	triggers: [],
	manifestPath: 'src/public/parts/shells/chat/test/manifest.json',
	heavy: false,
}

/** @type {import('../scripts/test/core/manifest.mjs').SuiteDef} */
const fedDm = {
	...fedTest,
	name: 'fed_dm',
	id: 'fed_dm',
}

/** @type {import('../scripts/test/core/manifest.mjs').SuiteDef} */
const unit = {
	...fedTest,
	name: 'unit',
	id: 'unit',
	heavy: true,
}

/** @type {import('../scripts/test/core/manifest.mjs').SuiteDef} */
const e2eSingle = {
	...fedTest,
	name: 'e2e_single',
	id: 'e2e_single',
}

Deno.test('suiteMatchesSelector exact id/name', () => {
	assertEquals(suiteMatchesSelector(fedTest, 'fed_test'), true)
	assertEquals(suiteMatchesSelector(fedTest, 'fed_dm'), false)
})

Deno.test('suiteMatchesSelector glob fed_*', () => {
	assertEquals(suiteMatchesSelector(fedTest, 'fed_*'), true)
	assertEquals(suiteMatchesSelector(fedDm, 'fed_*'), true)
	assertEquals(suiteMatchesSelector(unit, 'fed_*'), false)
})

Deno.test('suiteMatchesSelector prefix fed', () => {
	assertEquals(suiteMatchesSelector(fedTest, 'fed'), true)
	assertEquals(suiteMatchesSelector(fedDm, 'fed'), true)
	assertEquals(suiteMatchesSelector(unit, 'fed'), false)
})

Deno.test('suiteMatchesSelector prefix e2e', () => {
	assertEquals(suiteMatchesSelector(e2eSingle, 'e2e'), true)
	assertEquals(suiteMatchesSelector(e2eSingle, 'e2e_*'), true)
})

Deno.test('filterSuites applies glob selectors', () => {
	const suites = [fedTest, fedDm, unit, e2eSingle]
	const filtered = filterSuites(suites, {
		manifestIds: ['shells/chat'],
		suiteSelectors: ['fed_*'],
	})
	assertEquals(filtered.map(s => s.id).sort(), ['fed_dm', 'fed_test'])
})
