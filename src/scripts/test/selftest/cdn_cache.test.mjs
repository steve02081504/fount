/**
 * CDN URL 谓词。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { isExternalCdnUrl } from '../playwright/cdn_cache.mjs'

Deno.test('isExternalCdnUrl matches known CDN hosts only', () => {
	assertEquals(isExternalCdnUrl('https://esm.sh/@sentry/browser'), true)
	assertEquals(isExternalCdnUrl('https://api.iconify.design/mdi/heart.svg'), true)
	assertEquals(isExternalCdnUrl('https://cdn.jsdelivr.net/npm/daisyui'), true)
	assertEquals(isExternalCdnUrl('http://localhost:8931/base.mjs'), false)
	assertEquals(isExternalCdnUrl('https://example.com/x'), false)
	assertEquals(isExternalCdnUrl('not-a-url'), false)
})
