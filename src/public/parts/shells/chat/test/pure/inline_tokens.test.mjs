/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { parseInlineTokens } from 'fount/public/parts/shells/chat/public/shared/inlineTokens.mjs'
import {
	EMOJI_TOKEN_RE,
	INLINE_TOKEN_RE,
	LINK_TOKEN_RE,
	MENTION_TOKEN_RE,
	formatChannelToken,
	formatEmojiToken,
	formatEntityMentionToken,
	formatGroupToken,
	formatMessageToken,
	formatRoleMentionToken,
	parseEmojiRef,
	parseEmojiToken,
} from 'fount/public/parts/shells/chat/public/shared/inlineTokenSyntax.mjs'
import {
	buildMentionsStructure,
	extractMentionEntityHashes,
	extractMentionRoleIds,
	hasEveryoneToken,
	hasHereToken,
} from 'fount/public/parts/shells/chat/public/shared/mentions.mjs'


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

Deno.test('parseInlineTokens rejects mixed-case entity hashes', () => {
	const upper = HASH.toUpperCase()
	assertEquals(parseInlineTokens(`@[entity:${upper}]`).map(token => token.body), [])
	assertEquals(extractMentionEntityHashes(`@[entity:${HASH}] @[entity:${upper}]`), [HASH])
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

Deno.test('parseEmojiRef distinguishes pack token vs unicode', () => {
	const token = formatEmojiToken('pack_1', 'sad')
	assertEquals(parseEmojiToken(token), { packId: 'pack_1', emojiId: 'sad' })
	assertEquals(parseEmojiRef(token), { kind: 'pack', packId: 'pack_1', emojiId: 'sad' })
	assertEquals(parseEmojiRef('👍'), { kind: 'unicode', unicode: '👍' })
	assertEquals(parseEmojiRef('  '), null)
	assertEquals(parseEmojiRef(''), null)
	assertEquals(parseEmojiRef('p1/a'), { kind: 'unicode', unicode: 'p1/a' })
})

Deno.test('MENTION_TOKEN_RE / LINK_TOKEN_RE cover canonical inline tokens (no drift from INLINE_TOKEN_RE)', () => {
	const samples = [
		formatEntityMentionToken(HASH),
		formatRoleMentionToken('admin'),
		formatRoleMentionToken('everyone'),
		formatChannelToken('g1', 'c1'),
		formatGroupToken('g2'),
		formatMessageToken('g1', 'c1', 'mid1'),
		formatEmojiToken('p1', 'e1'),
	]
	/**
	 * 断言正则整串匹配。
	 * @param {RegExp} regex 正则
	 * @param {string} text 文本
	 * @returns {boolean} 是否整串匹配
	 */
	const matchesFull = (regex, text) => {
		regex.lastIndex = 0
		const m = regex.exec(text)
		return !!m && m.index === 0 && m[0] === text
	}
	for (const text of samples) {
		assertEquals(matchesFull(INLINE_TOKEN_RE, text), true, `INLINE_TOKEN_RE should match ${text}`)
		const covered = matchesFull(MENTION_TOKEN_RE, text)
			|| matchesFull(LINK_TOKEN_RE, text)
			|| matchesFull(EMOJI_TOKEN_RE, text)
		assertEquals(covered, true, `per-token regex should cover ${text}`)
	}
	// 分类型各自命中，且互不越界
	assertEquals(matchesFull(MENTION_TOKEN_RE, formatEntityMentionToken(HASH)), true)
	assertEquals(matchesFull(MENTION_TOKEN_RE, formatRoleMentionToken('admin')), true)
	assertEquals(matchesFull(MENTION_TOKEN_RE, formatChannelToken('g1', 'c1')), false)
	assertEquals(matchesFull(LINK_TOKEN_RE, formatChannelToken('g1', 'c1')), true)
	assertEquals(matchesFull(LINK_TOKEN_RE, formatGroupToken('g2')), true)
	assertEquals(matchesFull(LINK_TOKEN_RE, formatMessageToken('g1', 'c1', 'mid1')), true)
	assertEquals(matchesFull(LINK_TOKEN_RE, formatEntityMentionToken(HASH)), false)
})
