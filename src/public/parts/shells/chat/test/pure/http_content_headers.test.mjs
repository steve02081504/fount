/**
 * 同源文件下发：危险 MIME 强制 attachment + octet-stream + nosniff。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	applySafeContentHeaders,
	isInlineSafeMimeType,
} from '../../../../../../scripts/http_content.mjs'

/**
 * @returns {{ headers: Map<string, string>, setHeader: (k: string, v: string) => void }} mock res
 */
function mockRes() {
	const headers = new Map()
	return {
		headers,
		setHeader(key, value) {
			headers.set(String(key).toLowerCase(), String(value))
		},
	}
}

Deno.test('isInlineSafeMimeType allows images, rejects html/svg', () => {
	assertEquals(isInlineSafeMimeType('image/png'), true)
	assertEquals(isInlineSafeMimeType('text/html'), false)
	assertEquals(isInlineSafeMimeType('image/svg+xml'), false)
})

Deno.test('applySafeContentHeaders forces attachment for html', () => {
	const res = mockRes()
	const result = applySafeContentHeaders(res, { mimeType: 'text/html', filename: 'x.html' })
	assertEquals(result.inline, false)
	assertEquals(res.headers.get('content-type'), 'application/octet-stream')
	assertEquals(res.headers.get('x-content-type-options'), 'nosniff')
	assertEquals(res.headers.get('content-disposition')?.startsWith('attachment;'), true)
})

Deno.test('applySafeContentHeaders keeps png inline with nosniff', () => {
	const res = mockRes()
	const result = applySafeContentHeaders(res, { mimeType: 'image/png' })
	assertEquals(result.inline, true)
	assertEquals(res.headers.get('content-type'), 'image/png')
	assertEquals(res.headers.get('x-content-type-options'), 'nosniff')
	assertEquals(res.headers.has('content-disposition'), false)
})
