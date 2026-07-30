/**
 * CDN URL 谓词与 i18n SCREAMING_SNAKE 键规则。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import {
	camelPrefixes,
	decapitalize,
	isScreamingSnakeKey,
} from '../../checks/i18n_keys.mjs'
import { isExternalCdnUrl } from '../playwright/cdn_cache.mjs'

Deno.test('isExternalCdnUrl matches known CDN hosts only', () => {
	assertEquals(isExternalCdnUrl('https://esm.sh/@sentry/browser'), true)
	assertEquals(isExternalCdnUrl('https://api.iconify.design/mdi/heart.svg'), true)
	assertEquals(isExternalCdnUrl('https://cdn.jsdelivr.net/npm/daisyui'), true)
	assertEquals(isExternalCdnUrl('http://localhost:8931/base.mjs'), false)
	assertEquals(isExternalCdnUrl('https://example.com/x'), false)
	assertEquals(isExternalCdnUrl('not-a-url'), false)
})

Deno.test('SCREAMING_SNAKE keys skip camel prefix clusters', () => {
	assertEquals(isScreamingSnakeKey('SEND_MESSAGES'), true)
	assertEquals(isScreamingSnakeKey('permSEND_MESSAGES'), false)
	assertEquals(camelPrefixes('SEND_MESSAGES'), [])
	assertEquals(decapitalize('SEND_MESSAGES'), 'SEND_MESSAGES')
	assertEquals(decapitalize('RelayUrlsTip'), 'relayUrlsTip')
})
