/**
 * GitHub Pages 覆写的 registries 客户端不打 /api/registries。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { getRegistry, importRegistryModules } from '../scripts/endpoints/registries.mjs'

Deno.test('Pages getRegistry returns [] without fetch', async () => {
	/** @type {string[]} */
	const urls = []
	const previousFetch = globalThis.fetch
	/**
	 * @param {string | URL | Request} url 请求 URL
	 * @returns {Promise<Response>} 假响应
	 */
	function mockFetch(url) {
		urls.push(String(url))
		return Promise.resolve(new Response('[]', { status: 200 }))
	}
	globalThis.fetch = mockFetch
	try {
		assertEquals(await getRegistry('markdown_extensions'), [])
		assertEquals(await importRegistryModules('emoji'), [])
		assertEquals(urls, [])
	}
	finally {
		globalThis.fetch = previousFetch
	}
})
