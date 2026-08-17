/**
 * PHP 诱饵页：X-Powered-By 触发扫描后由 *.php.html / *.php.mjs 响应。
 */
/* global Deno */
import { assertEquals, assertMatch } from 'jsr:@std/assert'

import { launchNode, stopNode } from '../../../scripts/test/node/launch.mjs'

Deno.test({
	name: 'php decoy serves server-status.php.html',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchNode({
		username: 'php-decoy-user',
		apiKey: `fount-php-decoy-${Date.now().toString(36)}`,
	})
	const { baseUrl, apiKey } = node
	try {
		const res = await fetch(`${baseUrl}/server-status.php?fount-apikey=${encodeURIComponent(apiKey)}`)
		assertEquals(res.status, 200)
		assertEquals(res.headers.get('x-powered-by'), 'PHP/4.2.0')
		const body = await res.text()
		assertMatch(body, /Apache Server Status for localhost/)
		assertMatch(body, /GET \/server-status\.php HTTP/)
		const setCookie = res.headers.getSetCookie?.() ?? []
		const sessionCookie = setCookie.find(c => c.startsWith('PHPSESSID='))
		assertEquals(sessionCookie != null, true, 'first visit should set PHPSESSID')
	}
	finally {
		await stopNode(node)
	}
})
