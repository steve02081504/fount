/**
 * browserIntegration 的「本地版」用户脚本只发给确属本机的请求。
 *
 * 「本地版」把 `@require` 指向本机 `file://` 路径（便于跟随本地源码更新），
 * 因此判定必须同时要求 socket 回环**与** Host 回环：隧道 / 本机反代下
 * socket 是回环而 Host 是外部域名，只判 socket 会让远端访客拿到指向别人磁盘的脚本
 *（跑不起来，还泄露本机安装路径）。
 */
/* global Deno */
import { request } from 'node:http'

import { assert, assertEquals } from 'jsr:@std/assert'

import { launchNode, stopNode } from '../../../scripts/test/node/launch.mjs'

/**
 * 取用户脚本（可指定 Host 头）。
 * @param {string} baseUrl 节点根 URL
 * @param {string} apiKey API key（query 认证）
 * @param {string} [host] 覆盖 Host 头
 * @returns {Promise<{ status?: number, body: string }>} 响应
 */
function fetchUserscript(baseUrl, apiKey, host) {
	return new Promise((resolve, reject) => {
		const req = request(
			`${baseUrl}/virtual_files/parts/shells:browserIntegration/script.user.js?fount-apikey=${encodeURIComponent(apiKey)}`,
			host ? { headers: { host, 'x-forwarded-for': '203.0.113.9' } } : {},
			res => {
				let body = ''
				res.setEncoding('utf8')
				res.on('data', chunk => { body += chunk })
				res.on('end', () => resolve({ status: res.statusCode, body }))
			},
		)
		req.on('error', reject)
		req.end()
	})
}

Deno.test({
	name: 'browser integration userscript variant requires a loopback Host',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchNode({
		username: 'browser-integration-variant',
		apiKey: `fount-bi-variant-${Date.now().toString(36)}`,
	})
	try {
		// 正向对照：本机浏览器（Host 回环）拿到的本地版引用 file:// 路径。
		const local = await fetchUserscript(node.baseUrl, node.apiKey)
		assertEquals(local.status, 200, `loopback request must succeed (got ${JSON.stringify(local)})`)
		assert(local.body.includes('file:///'), 'loopback Host must get the file:// local variant')

		// 隧道 / 反代：socket 回环但 Host 是外部域名，必须回落到普通版。
		const forwarded = await fetchUserscript(node.baseUrl, node.apiKey, 'fount.example.invalid')
		assertEquals(forwarded.status, 200, `forwarded request must succeed (got ${JSON.stringify(forwarded)})`)
		assert(!forwarded.body.includes('file:///'), 'foreign Host on a loopback socket must not get the file:// variant')
		assert(!forwarded.body.includes('${file_protocol_url}'), 'foreign Host must not get the raw local template either')
	}
	finally {
		await stopNode(node)
	}
})
