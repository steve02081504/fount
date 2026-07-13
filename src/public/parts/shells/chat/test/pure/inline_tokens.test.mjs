/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	buildMentionsStructure,
	extractMentionEntityHashes,
	extractMentionRoleIds,
	hasEveryoneToken,
	hasHereToken,
} from 'fount/public/parts/shells/chat/public/shared/mentions.mjs'
import {
	formatChannelToken,
	formatEmojiToken,
	formatEntityMentionToken,
	formatRoleMentionToken,
} from 'fount/public/parts/shells/chat/public/shared/inlineTokenSyntax.mjs'
import { parseInlineTokens } from 'fount/public/parts/shells/chat/public/shared/inlineTokens.mjs'

const HASH = 'a'.repeat(128)

Deno.test('parseInlineTokens parses typed inline syntax', () => {
	const tokens = parseInlineTokens([
		`hi ${formatEntityMentionToken(HASH)}`,
		formatRoleMentionToken('admin'),
		formatRoleMentionToken('everyone'),
		formatRoleMentionToken('here'),
		formatEmojiToken('g', 'e'),
		formatChannelToken('grp', 'ch'),
	].join(' '))
	assertEquals(tokens.map(token => token.kind), ['entity', 'role', 'everyone', 'everyone', 'emoji', 'channel'])
})

Deno.test('extractMentionEntityHashes ignores bare @128hex', () => {
	assertEquals(extractMentionEntityHashes(`@${HASH}`), [])
	assertEquals(extractMentionEntityHashes(formatEntityMentionToken(HASH)), [HASH])
	assertEquals(extractMentionEntityHashes(`@[${HASH}]`), [])
})

Deno.test('buildMentionsStructure respects permission and ingress', () => {
	const text = `${formatRoleMentionToken('admin')} ${formatRoleMentionToken('everyone')} ${formatRoleMentionToken('here')}`
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
	assertEquals(buildMentionsStructure(`${formatRoleMentionToken('admin')} ${formatRoleMentionToken('here')}`, { canMentionEveryone: true, ingress: 'backfill' }), {
		entityHashes: [],
		roleIds: ['admin'],
		everyone: false,
	})
})

Deno.test('@[role:everyone] buildMentionsStructure does not expand member list', () => {
	const result = buildMentionsStructure(`hi ${formatRoleMentionToken('everyone')}`, { canMentionEveryone: true, ingress: 'live' })
	assertEquals(result.everyone, true)
	assertEquals(result.entityHashes.length, 0)
	assertEquals(result.roleIds.length, 0)
})

Deno.test('role and everyone token helpers', () => {
	const text = `${formatRoleMentionToken('everyone')} ${formatRoleMentionToken('here')} ${formatRoleMentionToken('x')}`
	assertEquals(hasEveryoneToken(text), true)
	assertEquals(hasHereToken(text), true)
	assertEquals(extractMentionRoleIds(text), ['x'])
})
