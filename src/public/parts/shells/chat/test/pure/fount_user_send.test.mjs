/**
 * fount.user.send 载荷规范化。
 */
/* global Deno */
import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { normalizeUserSendPayload } from '../../public/shared/fountUserSend.mjs'

Deno.test('normalizeUserSendPayload: string', () => {
	const { content, files } = normalizeUserSendPayload('hello', { locale: 'en-US' })
	assertEquals(content, { type: 'text', content: 'hello', locale: 'en-US' })
	assertEquals(files, [])
})

Deno.test('normalizeUserSendPayload: chatLogEntry fields', () => {
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
			buffer: 'dGVzdA==',
			description: 'note',
		}],
	})
	assertEquals(content, {
		type: 'text',
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
		buffer: 'dGVzdA==',
		description: 'note',
	}])
})

Deno.test('normalizeUserSendPayload: ArrayBuffer file buffer', () => {
	const bytes = new Uint8Array([116, 101, 115, 116])
	const { files } = normalizeUserSendPayload({
		content: 'x',
		files: [{ name: 'b.bin', mime_type: 'application/octet-stream', buffer: bytes }],
	}, { locale: 'zh-CN' })
	assertEquals(files[0].buffer, btoa('test'))
})

Deno.test('normalizeUserSendPayload: rejects garbage', () => {
	assertThrows(() => normalizeUserSendPayload(null), Error, 'expects string or chatLogEntry')
	assertThrows(() => normalizeUserSendPayload(42), Error, 'expects string or chatLogEntry')
})
