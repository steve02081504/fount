/**
 * 写死端口 hook 把 query 302 到 canonical callback。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { startPortHook, withQuery } from '../../src/portHook.mjs'

Deno.test('port hook 302 forwards code and state', async () => {
	const port = 18765
	const target = 'http://localhost:8931/parts/shells:oauth_handler/callback'
	const hook = await startPortHook({
		port,
		pathname: '/auth/callback',
		targetUrl: target,
	})
	try {
		const response = await fetch(`http://localhost:${port}/auth/callback?code=c1&state=s1`, { redirect: 'manual' })
		assertEquals(response.status, 302)
		assertEquals(
			response.headers.get('location'),
			withQuery(target, '?code=c1&state=s1'),
		)
		const missing = await fetch(`http://localhost:${port}/nope`, { redirect: 'manual' })
		assertEquals(missing.status, 404)
	}
	finally {
		await hook.close()
	}
})
