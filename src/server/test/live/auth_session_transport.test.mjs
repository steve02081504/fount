/**
 * 会话 Cookie 传输回归：
 * 1) Cookie 会话必须在 diff_if_auth 之前解析，认证用户才能拿到大请求体上限；
 * 2) WebSocket 升级无法下发轮换后的 Cookie，此时不得消费/撤销刷新令牌，否则客户端会被登出。
 */
/* global Deno */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'
import WebSocket from 'npm:ws'

import { wsBaseUrl } from '../../../scripts/test/core/url.mjs'
import { bootInProcess } from '../../../scripts/test/node/boot.mjs'
import { launchNode, stopNode } from '../../../scripts/test/node/launch.mjs'

/**
 * 从 Set-Cookie 响应头取出指定 cookie 最后的非空 name=value。
 * 未认证请求经 diff_if_auth 会先下发清除用的空 Cookie，真实登录 Cookie 在其后，
 * 因此必须取最后一个非空值。
 * @param {Headers} headers 响应头
 * @param {string} name cookie 名
 * @returns {string|undefined} `name=value` 或缺失时 undefined
 */
function cookiePairFromSetCookie(headers, name) {
	const cookies = headers.getSetCookie?.() ?? [headers.get('set-cookie')].filter(Boolean)
	const prefix = `${name}=`
	let found
	for (const raw of cookies) {
		const first = String(raw).split(';')[0]
		if (first.startsWith(prefix) && first.length > prefix.length) found = first
	}
	return found
}

/**
 * 用给定请求头完成 WebSocket 握手，判定结果。
 * @param {string} url WS URL
 * @param {Record<string, string>} headers 握手请求头
 * @returns {Promise<'open'|'rejected'|'error'|'timeout'>} 握手结果
 */
function connectWs(url, headers) {
	return new Promise(resolve => {
		const ws = new WebSocket(url, { headers })
		let settled = false
		/**
		 * @param {'open'|'rejected'|'error'|'timeout'} outcome 结果
		 * @returns {void}
		 */
		const done = outcome => {
			if (settled) return
			settled = true
			try { ws.close() } catch { /* already closed */ }
			resolve(outcome)
		}
		const timer = setTimeout(() => done('timeout'), 10_000)
		ws.on('open', () => { clearTimeout(timer); done('open') })
		ws.on('unexpected-response', () => { clearTimeout(timer); done('rejected') })
		ws.on('error', () => { clearTimeout(timer); done('error') })
	})
}

Deno.test({
	name: 'WebSocket upgrade auth does not consume or revoke the refresh token',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const dataPath = mkdtempSync(join(tmpdir(), 'fount_auth_ws_'))
	const username = 'auth-ws-refresh'
	const apiKey = `fount-auth-ws-${Date.now().toString(36)}`
	try {
		await bootInProcess({
			dataPath,
			username,
			apiKey,
			web: false,
			resetData: true,
			// Base 为真才会 initAuth（生成 JWT 密钥）——本用例需要签发令牌。
			// 子服务全部关闭，避免定时任务在清理目录后回写 config。
			starts: {
				IPC: false,
				Tray: false,
				DiscordRPC: false,
				Web: false,
				P2P: false,
				Base: { Jobs: false, Timers: false, Idle: false, AutoUpdate: false },
			},
		})
		const { config } = await import('../../server.mjs')
		const { loginWithApiKey, auth_request } = await import('../../auth/index.mjs')

		const loginResult = await loginWithApiKey(apiKey, 'ws-refresh-device', {
			ip: '127.0.0.1',
			headers: { 'user-agent': 'auth-ws-test' },
		})
		assertEquals(loginResult.status, 200)
		const refreshToken = loginResult.refreshToken
		const tokens = config.data.users[username].auth.refreshTokens
		assertEquals(tokens.length, 1)
		const oldJti = tokens[0].jti

		// 模拟 WebSocket 升级：WsAbleRouter 的模拟响应没有 cookie / clearCookie 方法。
		const wsReq = {
			ws: true,
			cookies: { refreshToken },
			headers: { 'user-agent': 'auth-ws-test' },
			ip: '127.0.0.1',
		}
		const wsRes = {
			/**
			 *
			 */
			setHeader() { },
			/**
			 *
			 */
			getHeader() { },
			/**
			 *
			 */
			removeHeader() { },
			/**
			 *
			 */
			end() { },
		}
		assert(await auth_request(wsReq, wsRes), 'WS upgrade with only a valid refresh token must authenticate')
		assertEquals(wsReq.user?.username, username)

		const after = config.data.users[username].auth.refreshTokens
		assert(after.some(t => t.jti === oldJti), 'WS upgrade must not consume the refresh token')
		assert(!config.data.revokedTokens[oldJti], 'WS upgrade must not revoke the refresh token')

		// 客户端随后用同一 refreshToken 走普通 HTTP 刷新，仍应成功（未被登出）。
		const httpReq = {
			cookies: { refreshToken },
			headers: { 'user-agent': 'auth-ws-test' },
			ip: '127.0.0.1',
		}
		const delivered = {}
		const httpRes = {
			/**
			 * 记录服务端写入的 Cookie，模拟 Express 的 `res.cookie`。
			 * @param {string} name Cookie 名
			 * @param {string} value Cookie 值
			 * @returns {void}
			 */
			cookie(name, value) { delivered[name] = value },
			/**
			 *
			 */
			clearCookie() { },
			/**
			 *
			 */
			setHeader() { },
			/**
			 *
			 */
			getHeader() { },
			/**
			 *
			 */
			removeHeader() { },
			/**
			 *
			 */
			status() { },
			/**
			 *
			 */
			json() { },
		}
		assert(
			await auth_request(httpReq, httpRes),
			'HTTP refresh with the same refresh token must still succeed after a WS upgrade',
		)
		assertEquals(httpReq.user?.username, username)
		assert(
			delivered.accessToken && delivered.refreshToken,
			'rotated cookies must be delivered on the HTTP refresh',
		)
	}
	finally {
		rmSync(dataPath, { recursive: true, force: true })
	}
})

Deno.test({
	name: 'authenticated cookie session bypasses the 5MB JSON body limit',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchNode({
		username: 'auth-cookie-body',
		apiKey: `fount-auth-cookie-body-${Date.now().toString(36)}`,
	})
	try {
		const { baseUrl, apiKey } = node
		const login = await fetch(`${baseUrl}/api/login`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ apiKey, deviceid: 'cookie-body-limit' }),
		})
		assertEquals(login.status, 200)
		const accessPair = cookiePairFromSetCookie(login.headers, 'accessToken')
		assert(accessPair, 'missing accessToken cookie')

		const bigBody = JSON.stringify({ blob: 'x'.repeat(6 * 1024 * 1024) })

		const anonymous = await fetch(`${baseUrl}/api/authenticate`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', Accept: 'application/json' },
			body: bigBody,
		})
		assert(anonymous.status !== 200, `unauthenticated oversized JSON must be rejected (got ${anonymous.status})`)

		const authenticated = await fetch(`${baseUrl}/api/authenticate`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', Accept: 'application/json', Cookie: accessPair },
			body: bigBody,
		})
		assertEquals(authenticated.status, 200, 'authenticated cookie session must bypass the 5MB JSON limit')
	}
	finally {
		await stopNode(node)
	}
})

Deno.test({
	name: 'WS upgrade with a session refresh cookie authenticates instead of logging out',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchNode({
		username: 'auth-ws-cookie',
		apiKey: `fount-auth-ws-cookie-${Date.now().toString(36)}`,
	})
	try {
		const { baseUrl, apiKey } = node
		const login = await fetch(`${baseUrl}/api/login`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ apiKey, deviceid: 'ws-cookie-device' }),
		})
		assertEquals(login.status, 200)
		const refreshPair = cookiePairFromSetCookie(login.headers, 'refreshToken')
		assert(refreshPair, 'missing refreshToken cookie')

		// 只带 refreshToken（等价于 accessToken 已过期）升级 WS：不得因无法下发新 Cookie 而拒绝。
		const url = `${wsBaseUrl(baseUrl)}/ws/test/auth_echo`
		const outcome = await connectWs(url, { Cookie: refreshPair })
		assertEquals(outcome, 'open', `WS upgrade with only a refresh cookie must succeed (got ${outcome})`)
	}
	finally {
		await stopNode(node)
	}
})
