/**
 * 草稿箱默认结构单元测试（Deno）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { loadDrafts, sanitizeDraftBody } from '../../src/drafts.mjs'

Deno.test('loadDrafts returns empty structure when file missing', async () => {
	const data = await loadDrafts('__social_drafts_missing_user__', 'a'.repeat(128))
	assertEquals(data.drafts, [])
})

Deno.test('sanitizeDraftBody strips file blobs and empty fields', () => {
	const body = sanitizeDraftBody({
		text: '  hello  ',
		mediaRefs: [{ path: 'x', file: {}, objectUrl: 'blob:1', pending: true, alt: 'a' }],
		visibility: 'public',
		sensitiveMedia: false,
	})
	assertEquals(body.text, 'hello')
	assertEquals(body.mediaRefs, [{ path: 'x', alt: 'a' }])
	assertEquals(body.visibility, 'public')
	assertEquals(body.sensitiveMedia, undefined)
})
