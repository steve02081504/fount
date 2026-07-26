/**
 * fount.user.send 载荷规范化。
 */
/* global Deno */
import { assertEquals, assertThrows } from 'jsr:@std/assert'

import { normalizeUserSendPayload } from '../../public/shared/fountUserSend.mjs'

Deno.test('normalizeUserSendPayload: string', () => {
	const { content, files } = normalizeUserSendPayload('hello', { locale: 'en-US' })
	assertEquals(content, { content: 'hello', locale: 'en-US' })
	assertEquals(files, [])
})

Deno.test('normalizeUserSendPayload: chatLogEntry fields', () => {
	const bytes = new Uint8Array([116, 101, 115, 116]) // 'test'
	const { content, files } = normalizeUserSendPayload({
		content: 'pick A',
		content_for_show: '<b>A</b>',
		content_for_edit: 'A',
		content_warning: 'cw',
		sensitive_media: true,
		locale: 'zh-CN',
		files: [{
			name: 'a.txt',
			mime_type: 'text/plain',
			buffer: bytes,
			description: 'note',
		}],
	})
	assertEquals(content, {
		content: 'pick A',
		content_for_show: '<b>A</b>',
		content_for_edit: 'A',
		content_warning: 'cw',
		sensitive_media: true,
		locale: 'zh-CN',
	})
	assertEquals(files, [{
		name: 'a.txt',
		mime_type: 'text/plain',
		buffer: btoa('test'),
		description: 'note',
	}])
})

Deno.test('normalizeUserSendPayload: rejects garbage', () => {
	assertThrows(() => normalizeUserSendPayload(null), Error, 'expects string or chatLogEntry')
	assertThrows(() => normalizeUserSendPayload(42), Error, 'expects string or chatLogEntry')
	assertThrows(() => normalizeUserSendPayload({
		content: 'x',
		files: [{ name: 'a', buffer: 'not-array-buffer' }],
	}), Error, 'file.buffer must be ArrayBuffer')
})
