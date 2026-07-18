/**
 * mediaRefUrl：拒绝 javascript: 等危险 scheme，回退到 EVFS 路径。
 */
/* global Deno */
import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { mediaRefUrl } from '../../public/shared/evfsMedia.mjs'

Deno.test('mediaRefUrl accepts https and relative paths', () => {
	assertEquals(mediaRefUrl({ url: 'https://example.com/a.jpg' }), 'https://example.com/a.jpg')
	assertEquals(mediaRefUrl({ url: '/api/parts/shells:chat/x' }), '/api/parts/shells:chat/x')
})

Deno.test('mediaRefUrl rejects javascript: and falls back to EVFS', () => {
	const entityHash = 'ab'.repeat(64)
	assertEquals(
		mediaRefUrl({ url: 'javascript:alert(1)', entityHash, path: 'a/b' }),
		`/api/parts/shells:chat/entities/${encodeURIComponent(entityHash)}/files/a/b`,
	)
	assertThrows(() => mediaRefUrl({ url: 'javascript:alert(1)' }), Error, 'invalid media ref')
	assertThrows(() => mediaRefUrl({ url: 'data:text/html,x' }), Error, 'invalid media ref')
})
