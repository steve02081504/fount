/**
 * CDN 响应缓存：谓词 + 假 context/route 驱动安装入口。
 */
/* global Deno */
import { Buffer } from 'node:buffer'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assertEquals, assert } from 'jsr:@std/assert'

import { cdnCacheDir } from '../core/paths.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import {
	cacheFileName,
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
 * 构造带 route 注册表的假 Playwright context。
 * @returns {{ context: { route: Function }, handlers: Array<{ predicate: Function, handler: Function }> }} 假 context 与已注册 handler
 */
function fakeContext() {
	/** @type {Array<{ predicate: Function, handler: Function }>} */
	const handlers = []
	return {
		handlers,
		context: {
			/**
			 * 注册 Playwright 风格 route 处理器。
			 * @param {(url: URL) => boolean} predicate URL 匹配谓词
			 * @param {(route: object) => Promise<void>} handler route 处理器
			 * @returns {Promise<void>}
			 */
			route: async (predicate, handler) => {
				handlers.push({ predicate, handler })
			},
		},
	}
}

/**
 * 构造假 Playwright route（可观测 fulfill/continue/fetch）。
 * @param {{ method?: string, url: string, headers?: Record<string, string>, fetchImpl?: () => object }} opts 假请求选项
 * @returns {{ route: object, fulfilled: object[], state: { continued: number, fetchCalls: number } }} 假 route 与观测状态
 */
function fakeRoute({ method = 'GET', url, headers = {}, fetchImpl } = {}) {
	/** @type {object[]} */
	const fulfilled = []
	const state = { continued: 0, fetchCalls: 0, aborted: 0 }
	const route = {
		/**
		 * @returns {{ method: () => string, url: () => string, headers: () => Record<string, string> }} 桩 request
		 */
		request: () => ({
			/**
			 * @returns {string} HTTP 方法
			 */
			method: () => method,
			/**
			 * @returns {string} 请求 URL
			 */
			url: () => url,
			/**
			 * @returns {Record<string, string>} 请求头
			 */
			headers: () => headers,
		}),
		/**
		 * 以缓存或合成响应 fulfill route。
		 * @param {object} options Playwright fulfill 载荷
		 * @returns {Promise<void>}
		 */
		fulfill: async options => {
			fulfilled.push(options)
		},
		/**
		 * 透传到真实网络栈。
		 * @returns {Promise<void>}
		 */
		continue: async () => {
			state.continued++
		},
		/**
		 * 中止请求。
		 * @returns {Promise<void>}
		 */
		abort: async () => {
			state.aborted++
		},
		/**
		 * 拉取上游并返回响应给处理器。
		 * @returns {Promise<object>} 桩 APIResponse
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
 * 构造假 Playwright APIResponse。
 * @param {{ status?: number, headers?: Record<string, string>, body?: Buffer | string }} opts 假响应选项
 * @returns {{ status: () => number, headers: () => Record<string, string>, body: () => Promise<Buffer> }} 假 APIResponse
 */
function fakeResponse({ status = 200, headers = {}, body = '' } = {}) {
	const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body)
	return {
		/**
		 * @returns {number} HTTP 状态码
		 */
		status: () => status,
		/**
		 * @returns {Record<string, string>} 响应头
		 */
		headers: () => ({ ...headers }),
		/**
		 * @returns {Promise<Buffer>} 响应体
		 */
		body: async () => bodyBuffer,
	}
}

Deno.test('installCdnResponseCache: GET/HEAD isolation, cache headers, disk refill, fetch fallback', async () => {
	clearCdnResponseMemoryCache()
	const previousCdnCacheFlag = process.env.FOUNT_TEST_CDN_CACHE
	delete process.env.FOUNT_TEST_CDN_CACHE
	const dir = cdnCacheDir(REPO_ROOT)
	await mkdir(dir, { recursive: true })
	const stamp = `cdn-cache-selftest-${Date.now()}`
	const getUrl = `https://esm.sh/${stamp}/get.js`
	const headUrl = `https://esm.sh/${stamp}/head.js`
	const diskUrl = `https://esm.sh/${stamp}/disk.js`
	const failUrl = `https://esm.sh/${stamp}/fail.js`
	const rangeUrl = `https://esm.sh/${stamp}/range.js`

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
				/** @returns {object} upstream GET response */
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
				/** @returns {object} upstream HEAD response */
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
				/** @returns {object} upstream HEAD response for GET URL */
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
			await writeFile(join(dir, cacheFileName('GET', diskUrl)), JSON.stringify({
				method: 'GET',
				url: diskUrl,
				status: 200,
				headers: {
					'content-type': 'text/plain',
					'content-encoding': 'br',
					'content-length': '2',
				},
				bodyBase64: Buffer.from('disk').toString('base64'),
			}))
			clearCdnResponseMemoryCache()
			const fromDisk = fakeRoute({ url: diskUrl })
			await handler(fromDisk.route)
			assertEquals(fromDisk.state.fetchCalls, 0)
			assertEquals(fromDisk.fulfilled.length, 1)
			assertEquals(fromDisk.fulfilled[0].body.toString(), 'disk')
			assertEquals(fromDisk.fulfilled[0].headers['content-encoding'], undefined)
			assertEquals(fromDisk.fulfilled[0].headers['content-length'], '4')
		}

		{
			const fail = fakeRoute({
				url: failUrl,
				/** @returns {never} simulated upstream failure */
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

		{
			const disposedUrl = `https://esm.sh/${stamp}/disposed.js`
			const disposed = fakeRoute({
				url: disposedUrl,
				/**
				 * @returns {object} body() 已 disposed 的桩响应
				 */
				fetchImpl: () => ({
					/**
					 * @returns {number} 状态码
					 */
					status: () => 200,
					/**
					 * @returns {Record<string, string>} 头
					 */
					headers: () => ({ 'content-type': 'text/plain' }),
					/**
					 * @returns {Promise<Buffer>} 抛 disposed
					 */
					body: async () => {
						throw new Error('apiResponse.body: Response has been disposed')
					},
				}),
			})
			await handler(disposed.route)
			assertEquals(disposed.state.fetchCalls, 1)
			assertEquals(disposed.fulfilled.length, 0)
			assertEquals(disposed.state.aborted, 1)
			assertEquals(disposed.state.continued, 0)
		}
	}
	finally {
		clearCdnResponseMemoryCache()
		if (previousCdnCacheFlag === undefined) delete process.env.FOUNT_TEST_CDN_CACHE
		else process.env.FOUNT_TEST_CDN_CACHE = previousCdnCacheFlag
		for (const [method, url] of [
			['GET', getUrl],
			['HEAD', headUrl],
			['HEAD', getUrl],
			['GET', diskUrl],
			['GET', failUrl],
		])
			await unlink(join(dir, cacheFileName(method, url))).catch(() => { /* may not exist */ })
	}
})
