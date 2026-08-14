/**
 * PKCE complete 在服务端换票，API 快照不含 oauth。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals } from 'jsr:@std/assert'

import { cancelLogin, completePkceLogin, loginStatus } from '../../src/login.mjs'
import { deletePending, getPending, putPending } from '../../src/pending.mjs'
import { CODEX } from '../../src/providers.mjs'

/**
 * 造一段带 ChatGPT account id 的假 JWT。
 * @param {string} accountId - account id。
 * @returns {string} JWT。
 */
function fakeJwt(accountId) {
	const payload = Buffer.from(JSON.stringify({
		'https://api.openai.com/auth': { chatgpt_account_id: accountId },
	})).toString('base64url')
	return `h.${payload}.s`
}

Deno.test('complete PKCE keeps oauth server-side and omits it from API snapshots', async () => {
	const originalFetch = globalThis.fetch
	/**
	 * 假 Codex token 换票。
	 * @returns {Promise<Response>} 假 token 响应。
	 */
	globalThis.fetch = async () => new Response(JSON.stringify({
		access_token: fakeJwt('acct'),
		refresh_token: 'refresh-secret',
		expires_in: 3600,
	}), { status: 200 })
	const state = `st-${crypto.randomUUID().slice(0, 8)}`
	putPending(state, {
		username: 'oauth-handler-test',
		providerId: CODEX.id,
		verifier: 'v',
		hook: {
			/**
			 * 测试用空 hook。
			 * @returns {Promise<void>} 关闭完成。
			 */
			close: async () => { },
		},
	})
	try {
		const completed = await completePkceLogin({ username: 'oauth-handler-test', state, code: 'c' })
		assertEquals(completed, { status: 'completed' })
		const snap = loginStatus('oauth-handler-test', state)
		assertEquals(snap.status, 'completed')
		assertEquals('oauth' in snap, false)
		assertEquals(getPending(state).oauth.refresh, 'refresh-secret')
	}
	finally {
		globalThis.fetch = originalFetch
		deletePending(state)
	}
})

Deno.test('cancel drops the pending session', () => {
	const state = `cancel-${crypto.randomUUID().slice(0, 8)}`
	putPending(state, { username: 'oauth-handler-test', providerId: CODEX.id, verifier: 'v' })
	try {
		cancelLogin('oauth-handler-test', state)
		assertEquals(loginStatus('oauth-handler-test', state).status, 'unknown')
	}
	finally {
		deletePending(state)
	}
})
