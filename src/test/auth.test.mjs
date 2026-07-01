/**
 * 框架级 HTTP / API key / 会话鉴权回归（非 shell 领域授权）。
 */
/* global Deno */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { allowNoise } from '../scripts/test/core/allowNoise.mjs'
import { wsBaseUrl } from '../scripts/test/core/url.mjs'
import { bootInProcess } from '../scripts/test/node/boot.mjs'
import { launchNode, stopNode } from '../scripts/test/node/launch.mjs'

Deno.test('verifyApiKey accepts valid key and rejects invalid or revoked', async () => {
	const dataPath = mkdtempSync(join(tmpdir(), 'fount_auth_unit_'))
	const username = 'auth-unit-user'
	const apiKey = 'fount-auth-unit-key-valid'
	try {
		await bootInProcess({
			dataPath,
			username,
			apiKey,
			web: false,
			resetData: true,
		})
		const { verifyApiKey, revokeApiKey } = await import('../server/auth.mjs')
		assert(await verifyApiKey(apiKey))
		assertEquals((await verifyApiKey(apiKey))?.username, username)
		assertEquals(await verifyApiKey('totally-invalid-key'), null)
		revokeApiKey(apiKey)
		assertEquals(await verifyApiKey(apiKey), null)
	}
	finally {
		rmSync(dataPath, { recursive: true, force: true })
	}
})

Deno.test({
	name: 'framework auth HTTP and WebSocket',
	sanitizeOps: false,
	sanitizeResources: false,
}, async t => {
	const node = await launchNode({
		username: 'auth-http-user',
		apiKey: `fount-auth-http-${Date.now().toString(36)}`,
	})
	const { baseUrl, apiKey, username } = node
	try {
		await t.step('GET /api/whoami with valid fount-apikey query', async () => {
			const res = await fetch(`${baseUrl}/api/whoami?fount-apikey=${encodeURIComponent(apiKey)}`)
			assertEquals(res.status, 200)
			assertEquals((await res.json()).username, username)
		})

		await t.step('GET /api/whoami with Authorization Bearer', async () => {
			const res = await fetch(`${baseUrl}/api/whoami`, {
				headers: { Authorization: `Bearer ${apiKey}` },
			})
			assertEquals(res.status, 200)
			assertEquals((await res.json()).username, username)
		})

		await t.step('GET /api/whoami without credentials returns 401 JSON', async () => {
			const res = await fetch(`${baseUrl}/api/whoami`, {
				headers: { Accept: 'application/json' },
			})
			assertEquals(res.status, 401)
		})

		await t.step('GET /api/whoami without credentials redirects HTML clients to login', async () => {
			const res = await fetch(`${baseUrl}/api/whoami`, {
				headers: { Accept: 'text/html,application/xhtml+xml' },
				redirect: 'manual',
			})
			assertEquals(res.status, 302)
			const location = res.headers.get('location') ?? ''
			assert(location.includes('/login'), `expected login redirect, got ${location}`)
		})

		await t.step('POST /api/apikey/verify distinguishes valid and invalid keys', async () => {
			const valid = await fetch(`${baseUrl}/api/apikey/verify`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ apiKey }),
			})
			assertEquals(valid.status, 200)
			assertEquals((await valid.json()).valid, true)

			const invalid = await fetch(`${baseUrl}/api/apikey/verify`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ apiKey: 'not-a-real-key' }),
			})
			assertEquals(invalid.status, 200)
			assertEquals((await invalid.json()).valid, false)
		})

		await t.step('POST /api/login with apiKey sets session cookies', async () => {
			const res = await fetch(`${baseUrl}/api/login`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ apiKey }),
			})
			assertEquals(res.status, 200)
			const cookies = typeof res.headers.getSetCookie === 'function'
				? res.headers.getSetCookie()
				: [res.headers.get('set-cookie')].filter(Boolean)
			assert(cookies.some(c => String(c).startsWith('accessToken=')), 'missing accessToken cookie')
		})

		await t.step('invalid fount-apikey rejected on /ws/test/auth_echo', async () => {
			const invalidUrl = `${wsBaseUrl(baseUrl)}/ws/test/auth_echo?fount-apikey=invalid-key-on-purpose`
			const result = await allowNoise(
				['WebSocket connection rejected', 'invalid-key-on-purpose'],
				() => new Promise(resolve => {
					const socket = new WebSocket(invalidUrl)
					const timer = setTimeout(() => { socket.close(); resolve('timeout') }, 5000)
					/** @returns {void} */
					socket.onopen = () => { clearTimeout(timer); socket.close(); resolve('opened') }
					/** @returns {void} */
					socket.onerror = () => { clearTimeout(timer); resolve('error') }
					/** @returns {void} */
					socket.onclose = () => { clearTimeout(timer); resolve('closed') }
				}),
			)
			assert(result !== 'opened', `ws accepted invalid apikey: ${result}`)
		})

		await t.step('valid fount-apikey connects to /ws/test/auth_echo', async () => {
			const url = `${wsBaseUrl(baseUrl)}/ws/test/auth_echo?fount-apikey=${encodeURIComponent(apiKey)}`
			await new Promise((resolve, reject) => {
				const socket = new WebSocket(url)
				const timer = setTimeout(() => { socket.close(); reject(new Error('ws timeout')) }, 10_000)
				/** @returns {void} */
				socket.onopen = () => { clearTimeout(timer); socket.close(); resolve(undefined) }
				/** @returns {void} */
				socket.onerror = () => { clearTimeout(timer); reject(new Error('ws error')) }
			})
		})
	}
	finally {
		await stopNode(node)
	}
})
