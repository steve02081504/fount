/**
 * WebSocket 升级的认证失败必须是真实 HTTP 状态。
 *
 * 旧实现把「未认证」写成硬编码的 `426 Upgrade Required`（无 body、无 header），
 * 浏览器端无法与「代理/客户端不支持 WebSocket」区分——隧道/反代下排查时因此被误导。
 * 另有放行漏洞：token 验签通过但用户不存在时 `req.user` 为 undefined 仍 `next()`，
 * 升级先「成功」，随后处理器抛 401。
 */
/* global Deno */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert'
import WebSocket from 'npm:ws'

import { markTempDirOriginSync } from '../../../scripts/test/core/temp_origin.mjs'
import { launchNode, stopNode } from '../../../scripts/test/node/launch.mjs'

const bootstrapPath = fileURLToPath(new URL('./fixtures/ws_token_bootstrap.mjs', import.meta.url))

/**
 * 探测一次 WebSocket 升级，返回握手结果（不进入消息阶段）。
 * @param {string} url WebSocket URL
 * @param {object} [options] 选项
 * @param {string} [options.protocols] `Sec-WebSocket-Protocol`（apiKey 认证用）
 * @param {Record<string, string>} [options.headers] 额外请求头
 * @returns {Promise<{ outcome: 'open' | 'http' | 'error' | 'timeout', status?: number, body?: string, message?: string }>} 握手结果
 */
function probeUpgrade(url, { protocols, headers = {} } = {}) {
	return new Promise(resolve => {
		const socket = protocols ? new WebSocket(url, protocols, { headers }) : new WebSocket(url, { headers })
		let settled = false
		/**
		 * 收尾并返回结果。
		 * @param {object} result 结果
		 * @returns {void}
		 */
		const done = result => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			try { socket.terminate() } catch { /* already closed */ }
			resolve(result)
		}
		const timer = setTimeout(() => done({ outcome: 'timeout' }), 15_000)
		socket.on('open', () => done({ outcome: 'open' }))
		socket.on('unexpected-response', (_request, response) => {
			let body = ''
			response.on('data', chunk => { body += chunk })
			response.on('end', () => done({ outcome: 'http', status: response.statusCode, body }))
		})
		socket.on('error', error => done({ outcome: 'error', message: error?.message }))
	})
}

/**
 * 节点根 URL → `/ws/notify` WebSocket URL。
 * @param {string} baseUrl 节点根 URL
 * @returns {string} WebSocket URL
 */
function notifyWsUrl(baseUrl) {
	return `${baseUrl.replace(/^http/u, 'ws')}/ws/notify`
}

Deno.test({
	name: 'unauthenticated /ws/notify upgrade answers 401 (not 426)',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchNode({
		username: 'ws-upgrade-auth',
		apiKey: `fount-ws-upgrade-${Date.now().toString(36)}`,
	})
	try {
		const rejected = await probeUpgrade(notifyWsUrl(node.baseUrl))
		assertEquals(rejected.outcome, 'http', `unauthenticated upgrade must get an HTTP answer (got ${JSON.stringify(rejected)})`)
		assertEquals(rejected.status, 401, `upgrade rejection must be 401 Unauthorized, not a fake 426 (got ${JSON.stringify(rejected)})`)
		assertStringIncludes(rejected.body ?? '', '"message"', 'rejection body must explain itself as JSON')
		assert(JSON.parse(rejected.body).message, 'rejection body must carry a message')

		// 正向对照：apiKey 作为 Sec-WebSocket-Protocol 时必须照常升级成功。
		const accepted = await probeUpgrade(notifyWsUrl(node.baseUrl), { protocols: node.apiKey })
		assertEquals(accepted.outcome, 'open', `apiKey upgrade must open (got ${JSON.stringify(accepted)})`)
	}
	finally {
		await stopNode(node)
	}
})

Deno.test({
	name: 'an invalid apiKey is cleared on the upgrade response without breaking the 401',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	// 无效 API Key 会被顺手 clearCookie：升级路径拿到的必须是能正常写 Set-Cookie 的真实响应对象，
	// 否则这里会 500（旧的 stub 响应没有 cookie 方法，全靠 `!req.ws` 绕过）。
	const node = await launchNode({
		username: 'ws-upgrade-bad-apikey',
		apiKey: `fount-ws-bad-apikey-${Date.now().toString(36)}`,
	})
	try {
		const rejected = await probeUpgrade(notifyWsUrl(node.baseUrl), { protocols: 'fount-not-a-real-key' })
		assertEquals(rejected.outcome, 'http', `invalid apiKey upgrade must get an HTTP answer (got ${JSON.stringify(rejected)})`)
		assertEquals(rejected.status, 401, `invalid apiKey upgrade must be 401 (got ${JSON.stringify(rejected)})`)
		assert(JSON.parse(rejected.body).message, 'rejection body must carry a message')
	}
	finally {
		await stopNode(node)
	}
})

Deno.test({
	name: 'access token of a missing user is rejected before the upgrade completes',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const tokenDir = await mkdtemp(join(tmpdir(), 'fount_ws_token_'))
	markTempDirOriginSync(tokenDir, 'server live ws_upgrade_auth bootstrap token')
	const tokenPath = join(tokenDir, 'accessToken')
	const node = await launchNode({
		username: 'ws-upgrade-missing-user',
		apiKey: `fount-ws-missing-user-${Date.now().toString(36)}`,
		bootstrap: bootstrapPath,
		extraEnv: { FOUNT_TEST_WS_TOKEN_OUT: tokenPath },
	})
	try {
		const token = (await readFile(tokenPath, 'utf8')).trim()
		assert(token.length > 0, 'bootstrap must mint an access token')

		const result = await probeUpgrade(notifyWsUrl(node.baseUrl), { headers: { Cookie: `accessToken=${token}` } })
		assertEquals(result.outcome, 'http', `token of a missing user must not complete the upgrade (got ${JSON.stringify(result)})`)
		assertEquals(result.status, 401, `token of a missing user must be 401 (got ${JSON.stringify(result)})`)
	}
	finally {
		await stopNode(node)
		await rm(tokenDir, { recursive: true, force: true })
	}
})
