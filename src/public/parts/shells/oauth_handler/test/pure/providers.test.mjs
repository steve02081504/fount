/**
 * OAuth provider 辅助：JWT account id、Copilot base URL、换票请求体。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals, assertThrows } from 'jsr:@std/assert'

import {
	chatgptAccountIdFromJwt,
	CODEX,
	copilotBaseUrl,
	exchangeCodexCode,
	githubDomain,
	fetchCodexModels,
} from '../../src/providers.mjs'

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

Deno.test('chatgptAccountIdFromJwt reads claim', () => {
	assertEquals(chatgptAccountIdFromJwt(fakeJwt('acct_1')), 'acct_1')
	assertEquals(chatgptAccountIdFromJwt('not-a-jwt'), undefined)
})

Deno.test('copilotBaseUrl from proxy-ep and enterprise', () => {
	assertEquals(
		copilotBaseUrl('tid=1;proxy-ep=proxy.individual.githubcopilot.com'),
		'https://api.individual.githubcopilot.com',
	)
	assertEquals(copilotBaseUrl(), 'https://api.individual.githubcopilot.com')
	assertEquals(copilotBaseUrl(undefined, 'github.example.com'), 'https://copilot-api.github.example.com')
})

Deno.test('githubDomain normalizes URL or host', () => {
	assertEquals(githubDomain(), 'github.com')
	assertEquals(githubDomain('https://github.example.com/foo'), 'github.example.com')
	assertEquals(githubDomain('github.example.com'), 'github.example.com')
})

Deno.test('githubDomain rejects loopback and private hosts', () => {
	assertThrows(() => githubDomain('http://127.0.0.1'), Error, 'internal')
	assertThrows(() => githubDomain('localhost'), Error, 'internal')
	assertThrows(() => githubDomain('10.0.0.1'), Error, 'internal')
	assertThrows(() => githubDomain('192.168.1.1'), Error, 'internal')
	assertThrows(() => githubDomain('169.254.169.254'), Error, 'internal')
})

Deno.test('Codex catalog uses current client version and returns only visible model choices and efforts', async () => {
	const calls = []
	const originalFetch = globalThis.fetch
	globalThis.fetch = async (url, init) => {
		calls.push({ url: String(url), init })
		if (calls.length === 1) return Response.json({ version: '0.157.1' })
		return Response.json({ models: [
			{ slug: 'model-a', display_name: 'Model A', visibility: 'list', supported_in_api: true,
				default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'ultra' }], secret: 'provider-private' },
			{ slug: 'hidden', visibility: 'hide', supported_reasoning_levels: [{ effort: 'high' }] },
			{ slug: 'unsupported', visibility: 'list', supported_in_api: false },
		] })
	}
	try {
		const models = await fetchCodexModels({ access: 'private-access', accountId: 'account-1' })
		assertEquals(calls[0].url, 'https://registry.npmjs.org/@openai%2fcodex/latest')
		assertEquals(calls[0].init, undefined) // Never send OAuth credentials to npm.
		assertEquals(new URL(calls[1].url).searchParams.get('client_version'), '0.157.1')
		assertEquals(calls[1].init.headers.Authorization, 'Bearer private-access')
		assertEquals(calls[1].init.headers['ChatGPT-Account-Id'], 'account-1')
		assertEquals(calls[1].init.redirect, 'error')
		assertEquals(models, [{
			slug: 'model-a', displayName: 'Model A', defaultReasoningLevel: 'medium',
			supportedReasoningLevels: ['low', 'ultra'],
		}])
		assertEquals(JSON.stringify(models).includes('private-access'), false)
	}
	finally {
		globalThis.fetch = originalFetch
	}
})

Deno.test('Codex catalog fails explicitly when client version cannot be obtained', async () => {
	const originalFetch = globalThis.fetch
	let calls = 0
	globalThis.fetch = async () => {
		calls++
		return Response.json({ version: 'not-a-version' })
	}
	try {
		let message
		try { await fetchCodexModels({ access: 'private-access', accountId: 'account-1' }) }
		catch (error) { message = error.message }
		assertEquals(message, 'Codex client version is unavailable')
		assertEquals(calls, 1) // No OAuth request to an unverified catalog URL.
	}
	finally {
		globalThis.fetch = originalFetch
	}
})

Deno.test('exchangeCodexCode posts PKCE body and keeps redirect_uri', async () => {
	const requests = []
	const originalFetch = globalThis.fetch
	/**
	 * 记下 Codex token 换票请求。
	 * @param {string | URL} url - 请求 URL。
	 * @param {RequestInit} [init] - fetch 选项。
	 * @returns {Promise<Response>} 假 token 响应。
	 */
	globalThis.fetch = async (url, init) => {
		requests.push({ url: String(url), init })
		return new Response(JSON.stringify({
			access_token: fakeJwt('acct_codex'),
			refresh_token: 'r',
			expires_in: 3600,
		}), { status: 200 })
	}
	try {
		const oauth = await exchangeCodexCode('the-code', 'the-verifier')
		assertEquals(oauth.accountId, 'acct_codex')
		assertEquals(requests.length, 1)
		assertEquals(requests[0].url, CODEX.tokenUrl)
		const body = new URLSearchParams(requests[0].init.body)
		assertEquals(body.get('grant_type'), 'authorization_code')
		assertEquals(body.get('code'), 'the-code')
		assertEquals(body.get('code_verifier'), 'the-verifier')
		assertEquals(body.get('redirect_uri'), CODEX.redirectUri)
		assertEquals(body.get('client_id'), CODEX.clientId)
	}
	finally {
		globalThis.fetch = originalFetch
	}
})
