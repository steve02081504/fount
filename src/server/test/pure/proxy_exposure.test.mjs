/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createExposureDetector, isLocalAddress } from '../../../scripts/proxy_exposure.mjs'

Deno.test('public Host without forwarding markers detects incompatible proxy deployment', async () => {
	let calls = 0
	const detect = createExposureDetector(async hostname => {
		calls++
		if (hostname === 'missing.invalid') throw new Error('DNS unavailable')
		return [{ address: hostname === 'lan.example' ? '192.168.1.2' : '8.8.8.8' }]
	})
	for (const host of ['localhost:8931', '127.0.0.1', '[::1]:8931', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::ffff:192.168.0.1]', '192.168.0.2', 'lan.example', 'missing.invalid', 'bad/host', undefined])
		assertEquals(await detect({ headers: { host } }), false, String(host))
	assertEquals(await detect({ headers: { host: 'public.example' } }), true)
	const before = calls
	assertEquals(await detect({ headers: { host: 'public.example:443' } }), true)
	assertEquals(calls, before)
	for (const name of ['forwarded', 'x-forwarded-for', 'X-Forwarded-Host', 'via', 'cf-ray'])
		assertEquals(await detect({ headers: { host: 'public.example', [name]: '' } }), false, name)
	assertEquals(await detect({ headers: { host: '8.8.8.8' } }), true)
	assertEquals(await detect({ headers: { host: '[2606:4700:4700::1111]' } }), true)
	for (const address of ['::ffff:127.0.0.1', '::ffff:7f00:1', 'fe80::1', 'fc00::1', '172.16.1.1', '100.64.0.1'])
		assertEquals(isLocalAddress(address), true, address)
})

Deno.test('unresolvable public Host is not exposed instead of throwing', async () => {
	const detect = createExposureDetector(async () => { throw new Error('DNS unavailable') })
	assertEquals(await detect({ headers: { host: 'public.example' } }), false)
})
