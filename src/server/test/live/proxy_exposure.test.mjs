/* global Deno */
import { request } from 'node:http'

import { assertEquals } from 'jsr:@std/assert'

import { PROXY_EXPOSURE_PAGE } from '../../../scripts/proxy_exposure.mjs'
import { allowNoise } from '../../../scripts/test/core/allowNoise.mjs'
import { waitUntil } from '../../../scripts/test/core/wait.mjs'
import { launchNode, stopNode } from '../../../scripts/test/node/launch.mjs'

/**
 * @param {string} url 请求 URL。
 * @param {object} headers 请求头。
 * @returns {Promise<object>} 响应状态与地址。
 */
function probe(url, headers) {
	return new Promise((resolve, reject) => {
		const req = request(url, { headers, agent: false }, res => {
			res.resume()
			res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location }))
		})
		req.on('error', reject)
		req.setTimeout(10_000, () => req.destroy(new Error('HTTP timeout')))
		req.end()
	})
}

Deno.test({
	name: 'public Host without proxy markers disables the real fount Web service until restart',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const node = await launchNode({ username: 'proxy-exposure-check', apiKey: `proxy-check-${Date.now()}` })
	try {
		assertEquals((await probe(`${node.baseUrl}/api/ping`, { host: '8.8.8.8', 'x-forwarded-for': '203.0.113.1' })).status, 200)
		const triggered = await allowNoise('Web service disabled: public Host without forwarding headers', () =>
			probe(`${node.baseUrl}/`, { host: '8.8.8.8', accept: 'text/html' }))
		assertEquals(triggered, { status: 303, location: PROXY_EXPOSURE_PAGE })
		await waitUntil(async () => {
			try { return (await probe(`${node.baseUrl}/api/ping`, { host: 'localhost' })).status === 500 }
			catch { return false }
		}, 10_000, 50)
		assertEquals((await probe(`${node.baseUrl}/api/ping`, { host: 'localhost', forwarded: 'for=remote' })).status, 500)
		assertEquals(await probe(`${node.baseUrl}/`, { host: 'localhost', accept: 'text/html' }), { status: 303, location: PROXY_EXPOSURE_PAGE })
	}
	finally { await stopNode(node) }
})
