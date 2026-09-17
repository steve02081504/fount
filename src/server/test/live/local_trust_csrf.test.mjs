/**
 * 本机免认证端点（/ws/eval、/api/register）必须拒绝浏览器跨站请求。
 * 仅凭 socket 回环不够：任意网页都能让本机浏览器访问 localhost。
 * `/ws/eval` 还须边执行边推 `eval_output`，最后才发 `eval_result`。
 */
/* global Deno */
import { Buffer } from 'node:buffer'
import { request } from 'node:http'

import { assert, assertEquals } from 'jsr:@std/assert'
import WebSocket from 'npm:ws'

import { launchNode, stopNode } from '../../../scripts/test/node/launch.mjs'

/**
 * 以给定请求探测 /ws/eval，收集下行帧。
 * @param {string} baseUrl 节点根 URL
 * @param {object} [options] 选项
 * @param {string | null} [options.origin] Origin 头；null 表示非浏览器（不带）
 * @param {object} [options.request] `eval_request` 载荷
 * @returns {Promise<{ outcome: 'eval' | 'http' | 'error' | 'timeout', status?: number, text?: string, frames: object[] }>} 结果
 */
function probeEval(baseUrl, {
	origin = null,
	request: evalRequest = { type: 'eval_request', id: 'probe', code: '\'local-trust-probe\'' },
} = {}) {
	return new Promise(resolve => {
		const url = `${baseUrl.replace(/^http/u, 'ws')}/ws/eval`
		const ws = origin
			? new WebSocket(url, { origin, headers: { origin } })
			: new WebSocket(url)
		/** @type {object[]} */
		const frames = []
		let settled = false
		/**
		 * @param {{ outcome: string, status?: number, text?: string }} result 结果
		 * @returns {void}
		 */
		const done = result => {
			if (settled) return
			settled = true
			try { ws.close() } catch { /* already closed */ }
			resolve({ ...result, frames })
		}
		const timer = setTimeout(() => done({ outcome: 'timeout' }), 10_000)
		ws.on('open', () => {
			ws.send(JSON.stringify(evalRequest))
		})
		ws.on('message', data => {
			const raw = String(data)
			try {
				frames.push(JSON.parse(raw))
			}
			catch { /* 忽略非 JSON 帧 */ }
			if (raw.includes('eval_result')) {
				clearTimeout(timer)
				done({ outcome: 'eval' })
			}
		})
		ws.on('unexpected-response', (_req, res) => {
			clearTimeout(timer)
			done({ outcome: 'http', status: res.statusCode })
		})
		ws.on('error', err => {
			clearTimeout(timer)
			done({ outcome: 'error', text: err?.message })
		})
	})
}

/**
 * 以给定 Origin POST /api/register。
 * @param {string} baseUrl 节点根 URL
 * @param {string | null} origin Origin 头；null 表示不带
 * @returns {Promise<{ status?: number, body?: string, error?: string }>} 响应
 */
function postRegister(baseUrl, origin) {
	return new Promise(resolve => {
		const target = new URL(`${baseUrl}/api/register`)
		const payload = JSON.stringify({
			username: `csrf-probe-${Date.now().toString(36)}`,
			password: 'Pw!localtrust',
		})
		const req = request({
			hostname: target.hostname,
			port: target.port,
			path: target.pathname,
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'content-length': Buffer.byteLength(payload),
				...origin ? { origin } : {},
			},
		}, res => {
			let body = ''
			res.on('data', chunk => { body += chunk })
			res.on('end', () => resolve({ status: res.statusCode, body }))
		})
		req.on('error', err => resolve({ error: err.message }))
		req.end(payload)
	})
}

Deno.test({
	name: '/ws/eval streams output before result and rejects a cross-site Origin',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchNode({
		username: 'local-trust-user',
		apiKey: `fount-local-trust-${Date.now().toString(36)}`,
	})
	try {
		// 正向对照：非浏览器（无 Origin）本机免认证，且输出先于结果到达。
		const structured = await probeEval(node.baseUrl, {
			request: { type: 'eval_request', id: 'structured', code: 'console.log(\'local-trust-probe\'); 1' },
		})
		assertEquals(structured.outcome, 'eval', `no-Origin local eval should work (got ${JSON.stringify(structured.frames)})`)
		const outputAt = structured.frames.findIndex(frame => frame.type === 'eval_output')
		const resultAt = structured.frames.findIndex(frame => frame.type === 'eval_result')
		assert(outputAt >= 0, 'streamed eval_output frame expected')
		assert(resultAt > outputAt, `eval_output must precede eval_result (got ${JSON.stringify(structured.frames.map(frame => frame.type))})`)
		assertEquals(structured.frames[outputAt].entry?.method, 'log')

		// 文本模式（CLI 用）：服务端渲染好文本，同样先 output 后 result。
		const text = await probeEval(node.baseUrl, {
			request: { type: 'eval_request', id: 'text', code: 'console.log(\'text-probe\'); 2', text: true, ansi: false },
		})
		assertEquals(text.outcome, 'eval')
		// 文本帧逐字回显：`console.log` 自带结尾换行，不做裁剪。
		assertEquals(text.frames.find(frame => frame.type === 'eval_output')?.text, 'text-probe\n')
		const textResult = text.frames.find(frame => frame.type === 'eval_result')
		assertEquals(textResult?.text, '2')
		assertEquals(textResult?.error, false)

		// 恶意网页从本机浏览器发起：socket 回环但 Origin 跨站，必须被拒。
		const evil = await probeEval(node.baseUrl, { origin: 'https://evil.example' })
		assert(evil.outcome !== 'eval', `cross-site Origin must not eval (got ${JSON.stringify(evil)})`)
	}
	finally {
		await stopNode(node)
	}
})

Deno.test({
	name: '/api/register ignores the local bypass for a cross-site Origin',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchNode({
		username: 'local-trust-register-user',
		apiKey: `fount-local-trust-register-${Date.now().toString(36)}`,
	})
	try {
		// 本机非浏览器注册：无验证码即可。
		const local = await postRegister(node.baseUrl, null)
		assert(local.status >= 200 && local.status < 300, `no-Origin local register should succeed (got ${JSON.stringify(local)})`)

		// 跨站表单：必须走非本机分支（无 PoW → 401）。
		const evil = await postRegister(node.baseUrl, 'https://evil.example')
		assertEquals(evil.status, 401, `cross-site register must require PoW (got ${JSON.stringify(evil)})`)
	}
	finally {
		await stopNode(node)
	}
})
