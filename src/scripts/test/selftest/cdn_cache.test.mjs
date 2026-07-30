/**
 * CDN 响应缓存：谓词 + 假 context/route 驱动安装入口。
 */
/* global Deno */
/* eslint-disable jsdoc/require-returns, jsdoc/require-param-type, jsdoc/require-param-description -- route/response fakes */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assertEquals, assert } from 'jsr:@std/assert'

import { cdnCacheDir } from '../core/paths.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import {
	clearCdnResponseMemoryCache,
	installCdnResponseCache,
	isExternalCdnUrl,
} from '../playwright/cdn_cache.mjs'

Deno.test('isExternalCdnUrl matches known CDN hosts only', () => {
	assertEquals(isExternalCdnUrl('https://esm.sh/@sentry/browser'), true)
	assertEquals(isExternalCdnUrl('https://api.iconify.design/mdi/heart.svg'), true)
	assertEquals(isExternalCdnUrl('https://cdn.jsdelivr.net/npm/daisyui'), true)
	assertEquals(isExternalCdnUrl('http://localhost:8931/base.mjs'), false)
	assertEquals(isExternalCdnUrl('https://example.com/x'), false)
	assertEquals(isExternalCdnUrl('not-a-url'), false)
})

/**
 * @param {string} method HTTP 方法
 * @param {string} url 完整 URL
 * @returns {string} 磁盘缓存文件名
 */
function cacheFileName(method, url) {
	return `${createHash('sha256').update(`${method}\n${url}`).digest('hex')}.json`
}

/**
 * @returns {{ context: { route: Function }, handlers: Array<{ predicate: Function, handler: Function }> }} 假 context 与已注册 handler
 */
function fakeContext() {
	/** @type {Array<{ predicate: Function, handler: Function }>} */
	const handlers = []
	return {
		handlers,
		context: {
			/**
			 *
			 * @param predicate
			 * @param handler
			 */
			route: async (predicate, handler) => {
				handlers.push({ predicate, handler })
			},
		},
	}
}

/**
 * @param {{ method?: string, url: string, headers?: Record<string, string>, fetchImpl?: () => object }} opts 假请求选项
 * @returns {{ route: object, fulfilled: object[], state: { continued: number, fetchCalls: number } }} 假 route 与观测状态
 */
function fakeRoute({ method = 'GET', url, headers = {}, fetchImpl } = {}) {
	/** @type {object[]} */
	const fulfilled = []
	const state = { continued: 0, fetchCalls: 0 }
	const route = {
		/**
		 *
		 */
		request: () => ({
			/**
			 *
			 */
			method: () => method,
			/**
			 *
			 */
			url: () => url,
			/**
			 *
			 */
			headers: () => headers,
		}),
		/**
		 *
		 * @param options
		 */
		fulfill: async options => {
			fulfilled.push(options)
		},
		/**
		 *
		 */
		continue: async () => {
			state.continued++
		},
		/**
		 *
		 */
		fetch: async () => {
			state.fetchCalls++
			if (fetchImpl) return fetchImpl()
			throw new Error('fetch not stubbed')
		},
	}
	return { route, fulfilled, state }
}

/**
 * @param {{ status?: number, headers?: Record<string, string>, body?: Buffer | string }} opts 假响应选项
 * @returns {{ status: () => number, headers: () => Record<string, string>, body: () => Promise<Buffer> }} 假 APIResponse
 */
function fakeResponse({ status = 200, headers = {}, body = '' } = {}) {
	const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
	return {
		/**
		 *
		 */
		status: () => status,
		/**
		 *
		 */
		headers: () => ({ ...headers }),
		/**
		 *
		 */
		body: async () => buf,
	}
}

Deno.test('installCdnResponseCache: GET/HEAD isolation, cache headers, disk refill, fetch fallback', async () => {
	clearCdnResponseMemoryCache()
	const prev = process.env.FOUNT_TEST_CDN_CACHE
	delete process.env.FOUNT_TEST_CDN_CACHE
	const dir = cdnCacheDir(REPO_ROOT)
	await mkdir(dir, { recursive: true })
	const stamp = `cdn-cache-selftest-${Date.now()}`
	const getUrl = `https://esm.sh/${stamp}/get.js`
	const headUrl = `https://esm.sh/${stamp}/head.js`
	const diskUrl = `https://esm.sh/${stamp}/disk.js`
	const failUrl = `https://esm.sh/${stamp}/fail.js`
	const rangeUrl = `https://esm.sh/${stamp}/range.js`
	const diskPath = join(dir, cacheFileName('GET', diskUrl))
	const written = []

	try {
		const { context, handlers } = fakeContext()
		await installCdnResponseCache(context)
		assertEquals(handlers.length, 1)
		const { predicate, handler } = handlers[0]
		assert(predicate(getUrl))
		assert(!predicate('http://localhost:8931/x'))

		{
			const get = fakeRoute({
				url: getUrl,
				/**
				 *
				 */
				fetchImpl: () => fakeResponse({
					headers: {
						'content-type': 'application/javascript',
						'content-encoding': 'gzip',
						'content-length': '999',
					},
					body: 'hello-cdn',
				}),
			})
			await handler(get.route)
			assertEquals(get.state.fetchCalls, 1)
			assertEquals(get.fulfilled.length, 1)
			assertEquals(get.fulfilled[0].body.toString(), 'hello-cdn')
			assertEquals(get.fulfilled[0].headers['content-length'], '9')
			assertEquals(get.fulfilled[0].headers['content-encoding'], undefined)
			assertEquals(get.state.continued, 0)
		}

		{
			const hit = fakeRoute({ url: getUrl })
			await handler(hit.route)
			assertEquals(hit.state.fetchCalls, 0)
			assertEquals(hit.fulfilled.length, 1)
			assertEquals(hit.fulfilled[0].body.toString(), 'hello-cdn')
			assertEquals(hit.fulfilled[0].headers['content-length'], '9')
		}

		{
			const head = fakeRoute({
				method: 'HEAD',
				url: headUrl,
				/**
				 *
				 */
				fetchImpl: () => fakeResponse({
					headers: {
						'content-type': 'application/javascript',
						'content-length': '42',
					},
					body: '',
				}),
			})
			await handler(head.route)
			assertEquals(head.fulfilled.length, 1)
			assertEquals(head.fulfilled[0].body, undefined)
			assertEquals(head.fulfilled[0].headers['content-length'], '42')
		}

		{
			const headOnGetUrl = fakeRoute({
				method: 'HEAD',
				url: getUrl,
				/**
				 *
				 */
				fetchImpl: () => fakeResponse({
					headers: { 'content-length': '7' },
					body: '',
				}),
			})
			await handler(headOnGetUrl.route)
			assertEquals(headOnGetUrl.state.fetchCalls, 1)
			assertEquals(headOnGetUrl.fulfilled[0].body, undefined)
			assertEquals(headOnGetUrl.fulfilled[0].headers['content-length'], '7')
		}

		{
			await writeFile(diskPath, JSON.stringify({
				method: 'GET',
				url: diskUrl,
				status: 200,
				headers: { 'content-type': 'text/plain', 'content-length': '4' },
				bodyBase64: Buffer.from('disk').toString('base64'),
			}))
			written.push(diskPath)
			clearCdnResponseMemoryCache()
			const fromDisk = fakeRoute({ url: diskUrl })
			await handler(fromDisk.route)
			assertEquals(fromDisk.state.fetchCalls, 0)
			assertEquals(fromDisk.fulfilled.length, 1)
			assertEquals(fromDisk.fulfilled[0].body.toString(), 'disk')
		}

		{
			const fail = fakeRoute({
				url: failUrl,
				/**
				 *
				 */
				fetchImpl: () => {
					throw new Error('upstream down')
				},
			})
			await handler(fail.route)
			assertEquals(fail.state.fetchCalls, 3)
			assertEquals(fail.fulfilled.length, 0)
			assertEquals(fail.state.continued, 1)
		}

		{
			const ranged = fakeRoute({
				url: rangeUrl,
				headers: { range: 'bytes=0-3' },
			})
			await handler(ranged.route)
			assertEquals(ranged.state.fetchCalls, 0)
			assertEquals(ranged.fulfilled.length, 0)
			assertEquals(ranged.state.continued, 1)
		}
	}
	finally {
		clearCdnResponseMemoryCache()
		if (prev === undefined) delete process.env.FOUNT_TEST_CDN_CACHE
		else process.env.FOUNT_TEST_CDN_CACHE = prev
		for (const path of written)
			await unlink(path).catch(() => { /* already gone */ })
		for (const [method, url] of [
			['GET', getUrl],
			['HEAD', headUrl],
			['HEAD', getUrl],
			['GET', failUrl],
		]) {
			const path = join(dir, cacheFileName(method, url))
			await unlink(path).catch(() => { /* may not exist on fail path */ })
		}
	}
})
