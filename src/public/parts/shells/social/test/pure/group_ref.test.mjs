/**
 * groupRef 与 expandChannelLinks 单元测试（Deno）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	expandChannelLinksInText,
	formatChatGroupHref,
} from '../../../chat/public/src/lib/expandChannelLinks.mjs'
import {
	formatGroupRefMarkdownToken,
	groupRefLabel,
	stripGroupRefMarkdownTokens,
} from '../../public/src/lib/groupRef.mjs'

Deno.test('formatChatGroupHref encodes group and channel', () => {
	const href = formatChatGroupHref('my group', 'ch 1')
	assertEquals(href.includes(encodeURIComponent('my group')), true)
	assertEquals(href.includes(encodeURIComponent('ch 1')), true)
})

Deno.test('expandChannelLinksInText expands channel and group tokens', () => {
	const channelHref = formatChatGroupHref('g1', 'c1')
	const groupHref = formatChatGroupHref('g2')
	assertEquals(
		expandChannelLinksInText('see #[g1/c1]'),
		`see [#g1/c1](${channelHref})`,
	)
	assertEquals(
		expandChannelLinksInText('join #[g2]'),
		`join [#g2](${groupHref})`,
	)
	assertEquals(
		expandChannelLinksInText('#[g1/c1] then #[g2]'),
		`[#g1/c1](${channelHref}) then [#g2](${groupHref})`,
	)
})

Deno.test('expandChannelLinksInText leaves plain hashtags unchanged', () => {
	assertEquals(expandChannelLinksInText('#hashtag plain'), '#hashtag plain')
})

Deno.test('expandChannelLinksInText href matches formatChatGroupHref', () => {
	assertEquals(
		expandChannelLinksInText('#[my-group/general]'),
		`[#my-group/general](${formatChatGroupHref('my-group', 'general')})`,
	)
})

Deno.test('groupRefLabel prefers custom label', () => {
	assertEquals(groupRefLabel({ groupId: 'g1', label: 'My server' }), 'My server')
	assertEquals(groupRefLabel({ groupId: 'g1', channelId: 'general' }), '#g1/general')
})

Deno.test('formatGroupRefMarkdownToken and strip', () => {
	const token = formatGroupRefMarkdownToken('my-group', 'general')
	assertEquals(token, '#[my-group/general]')
	const stripped = stripGroupRefMarkdownTokens(`hello\n\n${token}\n\ntail`)
	assertEquals(stripped, 'hello\n\ntail')
})
