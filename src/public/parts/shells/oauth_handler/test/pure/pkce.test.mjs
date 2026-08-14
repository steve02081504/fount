/**
 * PKCE 与 callback URL 拼接。
 */
/* global Deno */
import { assertEquals, assertNotEquals } from 'jsr:@std/assert'

import { generatePKCE, randomState } from '../../src/pkce.mjs'
import { canonicalCallbackUrl, withQuery } from '../../src/portHook.mjs'

Deno.test('PKCE verifier is base64url and challenge is S256', async () => {
	const { verifier, challenge } = generatePKCE()
	assertEquals(/^[A-Za-z0-9_-]+$/.test(verifier), true)
	assertEquals(verifier.includes('='), false)
	const { createHash } = await import('node:crypto')
	assertEquals(
		challenge,
		createHash('sha256').update(verifier).digest('base64')
			.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
	)
})

Deno.test('randomState is hex', () => {
	const firstState = randomState()
	const secondState = randomState()
	assertEquals(/^[0-9a-f]+$/.test(firstState), true)
	assertNotEquals(firstState, secondState)
})

Deno.test('canonical callback and query forward', () => {
	assertEquals(
		canonicalCallbackUrl('http://localhost:8931'),
		'http://localhost:8931/parts/shells:oauth_handler/callback',
	)
	assertEquals(
		withQuery('http://localhost:8931/parts/shells:oauth_handler/callback', '?code=abc&state=xyz'),
		'http://localhost:8931/parts/shells:oauth_handler/callback?code=abc&state=xyz',
	)
	assertEquals(
		withQuery('http://127.0.0.1:8931/parts/shells:oauth_handler/callback?keep=1', 'code=n&state=s'),
		'http://127.0.0.1:8931/parts/shells:oauth_handler/callback?keep=1&code=n&state=s',
	)
})
