/**
 * 前端 getRegistry：节点客户端打 /api/registries；失败不吞。
 */
/* global Deno */
import { assertEquals, assertRejects } from 'jsr:@std/assert'

import { getRegistry } from '../../../public/pages/scripts/endpoints/registries.mjs'

/**
 * 在指定 fetch 下跑回调。
 * @param {typeof fetch} fetchImpl mock fetch
 * @param {() => Promise<void>} run 回调
 * @returns {Promise<void>}
 */
async function withFetch(fetchImpl, run) {
	const previousFetch = globalThis.fetch
	globalThis.fetch = fetchImpl
	try {
		await run()
	}
	finally {
		globalThis.fetch = previousFetch
	}
}

/**
 * 记录请求 URL 并返回固定 Response。
 * @param {string[]} urls 收集到的 URL
 * @param {Response} response 固定响应
 * @returns {(url: string | URL | Request) => Promise<Response>} mock fetch
 */
function recordingFetch(urls, response) {
	return url => {
		urls.push(String(url))
		return Promise.resolve(response)
	}
}

Deno.test('getRegistry fetches on a fount node', async () => {
	/** @type {string[]} */
	const urls = []
	await withFetch(recordingFetch(urls, new Response(JSON.stringify([
		{ id: 'chat', level: 0, path: '/parts/shells:chat/markdown_extensions/index.mjs' },
	]), { status: 200, headers: { 'Content-Type': 'application/json' } })), async () => {
		const entries = await getRegistry('markdown_extensions', { nocache: true })
		assertEquals(entries.length, 1)
		assertEquals(entries[0].id, 'chat')
		assertEquals(urls, ['/api/registries/markdown_extensions?nocache=1'])
	})
})

Deno.test('getRegistry throws on HTTP error', async () => {
	await withFetch(() => Promise.resolve(new Response('', { status: 404 })), async () => {
		await assertRejects(
			() => getRegistry('markdown_extensions', { nocache: true }),
			Error,
			'registry fetch failed: markdown_extensions 404',
		)
	})
})
