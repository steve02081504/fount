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
