/* global Deno */
import { request } from 'node:http'

import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'
import WebSocket from 'npm:ws'

import { launchNode, stopNode } from '../../../scripts/test/node/launch.mjs'

/**
 * 原样发送 Host；fetch 会重写 Host，无法模拟回环 socket 上的隧道。
 * @param {string} url HTTP 地址。
 * @param {object} options 请求选项。
 * @returns {Promise<Response>} 响应。
 */
function requestHttp(url, options = {}) {
	return new Promise((resolve, reject) => {
		const req = request(url, options, res => {
			let body = ''
			res.setEncoding('utf8')
			res.on('data', chunk => { body += chunk })
			res.on('end', () => resolve(new Response(body, { status: res.statusCode })))
			res.on('error', reject)
		})
		req.on('error', reject)
		req.setTimeout(10_000, () => req.destroy(new Error('HTTP timeout')))
		req.end(options.body)
	})
}

/**
 * 只探测握手，不发送 eval 代码或读取日志。
 * @param {string} url WebSocket 地址。
 * @param {object} headers 请求头。
 * @returns {Promise<number>} HTTP 状态；101 表示握手成功。
 */
function upgradeStatus(url, headers) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url, { headers })
		const timer = setTimeout(() => { ws.terminate(); reject(new Error('upgrade timeout')) }, 10_000)
		ws.on('open', () => { clearTimeout(timer); ws.close(); resolve(101) })
		ws.on('unexpected-response', (_req, res) => {
			clearTimeout(timer)
			res.resume()
			ws.terminate()
			resolve(res.statusCode)
		})
		ws.on('error', error => { clearTimeout(timer); reject(error) })
	})
}

Deno.test({
	name: 'tunnel requests cannot acquire local HTTP or WebSocket privileges',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchNode({ username: 'tunnel-local-check', apiKey: `tunnel-check-${Date.now()}` })
	try {
		const local = await (await requestHttp(`${node.baseUrl}/api/ping`)).json()
		assertEquals(local.is_local_ip, true)
		assertEquals(await upgradeStatus(`${node.baseUrl.replace(/^http/u, 'ws')}/ws/eval`, {}), 101)
		for (const headers of [
			{ host: 'fount.example.invalid' },
			{ 'x-forwarded-for': '127.0.0.1' },
			{ forwarded: 'for=127.0.0.1;host=localhost' },
			{ 'x-forwarded-host': 'localhost' },
		]) {
			const ping = await (await requestHttp(`${node.baseUrl}/api/ping`, { headers })).json()
			assertEquals(ping.is_local_ip, false, JSON.stringify(headers))
			const missing = await requestHttp(`${node.baseUrl}/missing-tunnel-route`, { headers })
			assertEquals(missing.status, 500)
			assertStringIncludes(await missing.text(), 'Internal server error')
			const registration = await requestHttp(`${node.baseUrl}/api/register`, {
				method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
				body: JSON.stringify({ username: 'must-not-register', password: 'test-only-password' }),
			})
			assertEquals(registration.status, 401)
			assertEquals((await registration.json()).i18nKey, 'auth.error.powValidationFailed')
			const verification = await requestHttp(`${node.baseUrl}/api/p2p/verification/local`, { headers })
			assertEquals(verification.status, 403)
			await verification.body?.cancel()
			for (const path of ['/ws/eval', '/ws/logs'])
				assertEquals(await upgradeStatus(`${node.baseUrl.replace(/^http/u, 'ws')}${path}`, headers), 401)
		}
	}
	finally { await stopNode(node) }
})
