/**
 * 消息正文投影：历史 `[image:…]` 标记不得泄漏到展示 / agent / 编辑面。
 */
/* global Deno */
import { assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert'

import {
	messageAgentText,
	messageEditText,
	messageShowText,
	stripInlineImageMarkers,
} from '../../public/shared/channelContent.mjs'

const MARKER = '[image:home-bg.jpg|/api/parts/shells:chat/entities/abc/files/shells/chat/attachments/uuid]'
const MIXED = `hello\n${MARKER}\nworld`

Deno.test('stripInlineImageMarkers removes image tokens and trims leftover blank lines', () => {
	assertEquals(stripInlineImageMarkers(MARKER), '')
	assertEquals(stripInlineImageMarkers(MIXED), 'hello\nworld')
	assertEquals(stripInlineImageMarkers('plain'), 'plain')
	assertEquals(stripInlineImageMarkers(''), '')
})

Deno.test('messageShowText / messageAgentText / messageEditText strip legacy image markers', () => {
	const content = { content: MIXED, content_for_show: MIXED, content_for_edit: MIXED }
	assertEquals(messageShowText(content), 'hello\nworld')
	assertEquals(messageAgentText(content), 'hello\nworld')
	assertEquals(messageEditText(content), 'hello\nworld')
	assertFalse(messageShowText(content).includes('[image:'))
	assertFalse(messageAgentText({ content: MARKER }).includes('[image:'))
	assertStringIncludes(messageShowText({ content: 'keep me' }), 'keep me')
})
