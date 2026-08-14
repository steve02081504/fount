/**
 * Workers AI completions 端点。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { cloudflareWorkersAiUrl } from '../../src/url.mjs'

Deno.test('cloudflareWorkersAiUrl', () => {
	assertEquals(
		cloudflareWorkersAiUrl('acct'),
		'https://api.cloudflare.com/client/v4/accounts/acct/ai/v1/chat/completions',
	)
})
