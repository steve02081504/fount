/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	buildMentionsStructure,
	extractMentionEntityHashes,
	extractMentionRoleIds,
	hasEveryoneToken,
	hasHereToken,
} from 'fount/public/parts/shells/chat/public/shared/mentions.mjs'
import { parseInlineTokens } from 'fount/public/parts/shells/chat/public/shared/inlineTokens.mjs'

const HASH = 'a'.repeat(128)

Deno.test('parseInlineTokens parses new mention syntax', () => {
	const tokens = parseInlineTokens(`hi @[hash:${HASH}] @[role:admin] @[everyone] @[here] :[g/e] #[grp/ch]`)
	assertEquals(tokens.map(token => token.kind), ['entity', 'role', 'everyone', 'everyone', 'emoji', 'channel'])
})

Deno.test('extractMentionEntityHashes ignores bare @128hex', () => {
	assertEquals(extractMentionEntityHashes(`@${HASH}`), [])
	assertEquals(extractMentionEntityHashes(`@[hash:${HASH}]`), [HASH])
	assertEquals(extractMentionEntityHashes(`@[${HASH}]`), [])
})

Deno.test('buildMentionsStructure respects permission and ingress', () => {
	const text = `@[role:admin] @[everyone] @[here]`
	assertEquals(buildMentionsStructure(text, { canMentionEveryone: false, ingress: 'live' }), {
		entityHashes: [],
		roleIds: [],
		everyone: false,
	})
	assertEquals(buildMentionsStructure(text, { canMentionEveryone: true, ingress: 'live' }), {
		entityHashes: [],
		roleIds: ['admin'],
		everyone: true,
	})
	assertEquals(buildMentionsStructure(`@[role:admin] @[here]`, { canMentionEveryone: true, ingress: 'backfill' }), {
		entityHashes: [],
		roleIds: ['admin'],
		everyone: false,
	})
})

Deno.test('@[everyone] buildMentionsStructure does not expand member list', () => {
	const result = buildMentionsStructure('hi @[everyone]', { canMentionEveryone: true, ingress: 'live' })
	assertEquals(result.everyone, true)
	assertEquals(result.entityHashes.length, 0)
	assertEquals(result.roleIds.length, 0)
})

Deno.test('role and everyone token helpers', () => {
	const text = `@[everyone] @[here] @[role:x]`
	assertEquals(hasEveryoneToken(text), true)
	assertEquals(hasHereToken(text), true)
	assertEquals(extractMentionRoleIds(text), ['x'])
})
