/**
 * safeProfileLink：http(s) + fount:（经 protocol 页）；拒绝 javascript: 等。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { safeProfileLink } from '../../public/shared/safeProfileLink.mjs'
import { wrapProtocolHttpsUrl } from '../../public/shared/runUri.mjs'

Deno.test('safeProfileLink keeps http(s)', () => {
	assertEquals(safeProfileLink('https://example.com/a'), 'https://example.com/a')
	assertEquals(safeProfileLink('http://example.com/b'), 'http://example.com/b')
})

Deno.test('safeProfileLink wraps fount: via protocol page', () => {
	const uri = 'fount://run/shells:install/install;pkg'
	assertEquals(safeProfileLink(uri), wrapProtocolHttpsUrl(uri))
	const page = 'fount://page/parts/shells:social/#post;eh;pid'
	assertEquals(safeProfileLink(page), wrapProtocolHttpsUrl(page))
})

Deno.test('safeProfileLink rejects javascript: and empty', () => {
	assertEquals(safeProfileLink('javascript:alert(1)'), null)
	assertEquals(safeProfileLink('data:text/html,x'), null)
	assertEquals(safeProfileLink(''), null)
	assertEquals(safeProfileLink('  '), null)
})
