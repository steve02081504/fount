/**
 * 消息扩展字段纯函数测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { channelMessageContentObject } from '../../public/shared/channelContent.mjs'
import {
	sanitizeAlt,
	sanitizeContentWarning,
	sanitizeLocale,
	sanitizeMessageExtras,
	resolveSensitiveMedia,
} from '../../public/shared/messageFields.mjs'
import {
	formatMessageRunUri,
	parseMessageRunUri,
	wrapProtocolHttpsUrl,
} from '../../public/shared/runUri.mjs'

Deno.test('sanitizeLocale / content_warning / alt truncate', () => {
	assertEquals(sanitizeLocale('  zh-CN  '), 'zh-CN')
	assertEquals(sanitizeContentWarning('x'.repeat(300))?.length, 200)
	assertEquals(sanitizeAlt('  hello  '), 'hello')
	assertEquals(resolveSensitiveMedia(undefined, 'cw'), true)
	assertEquals(resolveSensitiveMedia(false, 'cw'), false)
})

Deno.test('sanitizeMessageExtras drops empty extras and embeds', () => {
	const out = sanitizeMessageExtras({
		type: 'text',
		content: 'hi https://example.com',
		locale: 'en-US',
		content_warning: 'spoilers',
		sensitive_media: true,
		embeds: [{ url: 'https://example.com', title: 'Example' }, { url: 'ftp://bad' }],
		forwardedFrom: {
			groupId: 'g1',
			channelId: 'default',
			eventId: 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
			senderName: 'bob',
		},
	})
	assertEquals(out.locale, 'en-US')
	assertEquals(out.content_warning, 'spoilers')
	assertEquals(out.sensitive_media, true)
	assertEquals(out.embeds, undefined)
	assertEquals(out.forwardedFrom.groupId, 'g1')
})

Deno.test('channelMessageContentObject sanitizes text extras', () => {
	const content = channelMessageContentObject({
		type: 'text',
		content: 'hello',
		locale: 'ja',
		content_warning: '  nsfw  ',
		embeds: [{ url: 'https://fount.example', title: 't' }],
	})
	assertEquals(content.locale, 'ja')
	assertEquals(content.content_warning, 'nsfw')
	assertEquals(content.sensitive_media, true)
	assertEquals(content.embeds, undefined)
})

Deno.test('message run URI round-trip and protocol wrap', () => {
	const uri = formatMessageRunUri('group1', 'general', 'deadbeef')
	const parsed = parseMessageRunUri(uri)
	assertEquals(parsed, { groupId: 'group1', channelId: 'general', eventId: 'deadbeef' })
	const https = wrapProtocolHttpsUrl(uri)
	assertEquals(https.startsWith('https://steve02081504.github.io/fount/protocol?url='), true)
})
