/**
 * groupRef 与 expandChannelLinks 单元测试（Deno）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	expandChannelLinksInText,
	formatChatGroupHref,
	formatChatMessageHref,
} from '../../../chat/public/shared/expandChannelLinks.mjs'
import {
	formatChannelToken,
	formatGroupToken,
	formatMessageToken,
	stripChannelTokens,
} from '../../../chat/public/shared/inlineTokenSyntax.mjs'
import { groupRefLabel, renderGroupRefBlockHtml } from '../../public/shared/groupRef.mjs'

Deno.test('formatChatGroupHref encodes group and channel', () => {
	const href = formatChatGroupHref('my group', 'ch 1')
	assertEquals(href.includes(encodeURIComponent('my group')), true)
	assertEquals(href.includes(encodeURIComponent('ch 1')), true)
})

Deno.test('expandChannelLinksInText expands channel and group tokens', () => {
	const channelHref = formatChatGroupHref('g1', 'c1')
	const groupHref = formatChatGroupHref('g2')
	assertEquals(
		expandChannelLinksInText(`see ${formatChannelToken('g1', 'c1')}`),
		`see [#g1/c1](${channelHref})`,
	)
	assertEquals(
		expandChannelLinksInText(`join ${formatGroupToken('g2')}`),
		`join [#g2](${groupHref})`,
	)
	assertEquals(
		expandChannelLinksInText(`${formatChannelToken('g1', 'c1')} then ${formatGroupToken('g2')}`),
		`[#g1/c1](${channelHref}) then [#g2](${groupHref})`,
	)
})

Deno.test('expandChannelLinksInText expands message tokens', () => {
	const messageHref = formatChatMessageHref('g1', 'c1', 'evt1234567890')
	assertEquals(
		expandChannelLinksInText(formatMessageToken('g1', 'c1', 'evt1234567890')),
		`[#g1/c1/evt12345…](${messageHref})`,
	)
})

Deno.test('expandChannelLinksInText leaves plain hashtags unchanged', () => {
	assertEquals(expandChannelLinksInText('#hashtag plain'), '#hashtag plain')
})

Deno.test('expandChannelLinksInText href matches formatChatGroupHref', () => {
	assertEquals(
		expandChannelLinksInText(formatChannelToken('my-group', 'general')),
		`[#my-group/general](${formatChatGroupHref('my-group', 'general')})`,
	)
})

Deno.test('groupRefLabel prefers custom label', () => {
	assertEquals(groupRefLabel({ groupId: 'g1', label: 'My server' }), 'My server')
	assertEquals(groupRefLabel({ groupId: 'g1', channelId: 'general' }), '#g1/general')
})

Deno.test('renderGroupRefBlockHtml escapes hostile label', () => {
	const html = renderGroupRefBlockHtml({
		groupId: 'g1',
		label: '<img src=x onerror=alert(1)>',
	})
	assertEquals(html.includes('<img'), false)
	assertEquals(html.includes('&lt;img src=x onerror=alert(1)&gt;'), true)
})

Deno.test('formatChannelToken and stripChannelTokens', () => {
	const token = formatChannelToken('my-group', 'general')
	assertEquals(token, '#[channel:my-group/general]')
	const stripped = stripChannelTokens(`hello\n\n${token}\n\ntail`)
	assertEquals(stripped, 'hello\n\ntail')
})
