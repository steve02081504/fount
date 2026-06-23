/**
 * groupRef 链接工具单元测试（Deno）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	formatChatGroupHref,
	formatGroupRefMarkdownToken,
	groupRefLabel,
	stripGroupRefMarkdownTokens,
} from '../../public/src/lib/groupRef.mjs'

Deno.test('formatChatGroupHref encodes group and channel', () => {
	const href = formatChatGroupHref('my group', 'ch 1')
	assertEquals(href.includes(encodeURIComponent('my group')), true)
	assertEquals(href.includes(encodeURIComponent('ch 1')), true)
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
