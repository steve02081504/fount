/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { filterSuites, suiteMatchesSelector } from '../core/manifest.mjs'

/** @type {import('../core/manifest.mjs').SuiteDef} */
const fedTest = {
	manifestId: 'shells/chat',
	name: 'fed_core',
	id: 'fed_core',
	run: [],
	triggers: [],
	manifestPath: 'src/public/parts/shells/chat/test/manifest.json',
	heavy: false,
	dependsOn: ['p2p:sim'],
	dependencies: [{ manifestId: 'p2p', name: 'sim' }],
}

/** @type {import('../core/manifest.mjs').SuiteDef} */
const fedDm = {
	...fedTest,
	name: 'fed_dm',
	id: 'fed_dm',
	dependsOn: undefined,
	dependencies: [],
}

/** @type {import('../core/manifest.mjs').SuiteDef} */
const pureSuite = {
	...fedTest,
	name: 'pure',
	id: 'pure',
	heavy: true,
	dependsOn: undefined,
	dependencies: [],
}

/** @type {import('../core/manifest.mjs').SuiteDef} */
const e2eSingle = {
	...fedTest,
	name: 'e2e_single',
	id: 'e2e_single',
	dependsOn: undefined,
	dependencies: [],
}

/** @type {import('../core/manifest.mjs').SuiteDef} */
const fedEmoji = {
	...fedTest,
	name: 'fed_emoji',
	id: 'fed_emoji',
	dependsOn: ['fed_core'],
	dependencies: [{ manifestId: 'shells/chat', name: 'fed_core' }],
}

/** @type {import('../core/manifest.mjs').SuiteDef} */
const fedEmojiNonmember = {
	...fedTest,
	name: 'fed_emoji_nonmember',
	id: 'fed_emoji_nonmember',
	dependsOn: ['fed_core', 'fed_emoji'],
	dependencies: [
		{ manifestId: 'shells/chat', name: 'fed_core' },
		{ manifestId: 'shells/chat', name: 'fed_emoji' },
	],
}

Deno.test('suiteMatchesSelector exact id/name', () => {
	assertEquals(suiteMatchesSelector(fedTest, 'fed_core'), true)
	assertEquals(suiteMatchesSelector(fedTest, 'fed_dm'), false)
})

Deno.test('suiteMatchesSelector glob fed_*', () => {
	assertEquals(suiteMatchesSelector(fedTest, 'fed_*'), true)
	assertEquals(suiteMatchesSelector(fedDm, 'fed_*'), true)
	assertEquals(suiteMatchesSelector(pureSuite, 'fed_*'), false)
})

Deno.test('suiteMatchesSelector prefix fed', () => {
	assertEquals(suiteMatchesSelector(fedTest, 'fed'), true)
	assertEquals(suiteMatchesSelector(fedDm, 'fed'), true)
	assertEquals(suiteMatchesSelector(pureSuite, 'fed'), false)
})

Deno.test('suiteMatchesSelector prefix e2e', () => {
	assertEquals(suiteMatchesSelector(e2eSingle, 'e2e'), true)
	assertEquals(suiteMatchesSelector(e2eSingle, 'e2e_*'), true)
})

Deno.test('filterSuites applies glob selectors', () => {
	const suites = [fedTest, fedDm, pureSuite, e2eSingle]
	const filtered = filterSuites(suites, {
		manifestIds: ['shells/chat'],
		suiteSelectors: ['fed_*'],
	})
	assertEquals(filtered.map(s => s.id).sort(), ['fed_core', 'fed_dm'])
})

Deno.test('filterSuites prefixExpand false matches exact dependsOn names only', () => {
	const suites = [fedEmoji, fedEmojiNonmember]
	const exact = filterSuites(suites, {
		manifestIds: ['shells/chat'],
		suiteSelectors: ['fed_emoji'],
	}, { prefixExpand: false })
	assertEquals(exact.map(s => s.id), ['fed_emoji'])
})

Deno.test('filterSuites exact suite name does not prefix-expand', () => {
	const suites = [fedEmoji, fedEmojiNonmember]
	// `fed_emoji` 本身即完整 suite 名，只应选中它自己，不拉入 fed_emoji_nonmember。
	const exact = filterSuites(suites, {
		manifestIds: ['shells/chat'],
		suiteSelectors: ['fed_emoji'],
	})
	assertEquals(exact.map(s => s.id), ['fed_emoji'])

	// 非完整名的前缀仍展开。
	const expanded = filterSuites(suites, {
		manifestIds: ['shells/chat'],
		suiteSelectors: ['fed_emo'],
	})
	assertEquals(expanded.map(s => s.id).sort(), ['fed_emoji', 'fed_emoji_nonmember'])
})
