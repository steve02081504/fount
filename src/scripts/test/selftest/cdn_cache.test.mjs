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
	isUnversionedEsmShUrl,
} from '../playwright/cdn_cache.mjs'

Deno.test('isExternalCdnUrl matches known CDN hosts only', () => {
	assertEquals(isExternalCdnUrl('https://esm.sh/@sentry/browser'), true)
	assertEquals(isExternalCdnUrl('https://api.iconify.design/mdi/heart.svg'), true)
	assertEquals(isExternalCdnUrl('https://cdn.jsdelivr.net/npm/daisyui'), true)
	assertEquals(isUnversionedEsmShUrl('https://esm.sh/@steve02081504/async-eval'), true)
	assertEquals(isUnversionedEsmShUrl('https://esm.sh/@steve02081504/async-eval@0.0.16/es2022/async-eval.mjs'), false)
	assertEquals(isUnversionedEsmShUrl('https://esm.sh/@steve02081504/fount-p2p/core/hexIds'), true)
	assertEquals(isUnversionedEsmShUrl('https://esm.sh/react'), true)
	assertEquals(isUnversionedEsmShUrl('https://esm.sh/react@18.2.0'), false)
	assertEquals(isUnversionedEsmShUrl('https://esm.sh/v135/react'), true)
	assertEquals(isUnversionedEsmShUrl('https://esm.sh/react?target=es2022'), true)
	assertEquals(isUnversionedEsmShUrl('https://api.iconify.design/mdi/heart.svg'), false)
	assertEquals(isUnversionedEsmShUrl('https://example.com/react'), false)
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

/**
 * 构造可观测的探测实现（供 installCdnResponseCache 注入）。
 * @param {(url: string, init?: { method?: string, headers?: Record<string, string> }) => { ok?: boolean, status?: number, headers?: Record<string, string> }} impl URL → 桩探测响应（throw 模拟网络失败）
 * @returns {{ probeFetch: (url: string, init?: { method?: string, headers?: Record<string, string> }) => Promise<{ ok?: boolean, status?: number, headers?: Record<string, string> }>, calls: Array<{ method: string, url: string, headers: Record<string, string> }> }} 探测实现与调用记录
 */
function fakeProbe(impl) {
	/** @type {Array<{ method: string, url: string, headers: Record<string, string> }>} */
	const calls = []
	return {
		calls,
		/**
		 * 记录并以桩响应完成探测。
		 * @param {string} url 探测 URL
		 * @param {{ method?: string, headers?: Record<string, string> }} [init] 请求 init
		 * @returns {Promise<{ ok?: boolean, status?: number, headers?: Record<string, string> }>} 桩探测响应
		 */
		probeFetch: async (url, init) => {
			calls.push({ method: init?.method ?? 'GET', url, headers: { ...init?.headers } })
			return impl(url, init)
		},
	}
}

/**
 * 向磁盘预置一条 GET 缓存。
 * @param {string} dir 缓存目录
 * @param {string} url 缓存 URL
 * @param {{ headers?: Record<string, string>, body?: string, status?: number }} [entry] 条目内容
 * @returns {Promise<void>}
 */
async function seedDisk(dir, url, { headers = {}, body = 'old', status = 200 } = {}) {
	await writeFile(join(dir, cacheFileName('GET', url)), JSON.stringify({
		method: 'GET',
		url,
		status,
		headers,
		bodyBase64: Buffer.from(body).toString('base64'),
	}))
}

Deno.test('installCdnResponseCache: unversioned esm.sh hits revalidate via x-esm-path', async () => {
	clearCdnResponseMemoryCache()
	const previousCdnCacheFlag = process.env.FOUNT_TEST_CDN_CACHE
	delete process.env.FOUNT_TEST_CDN_CACHE
	const dir = cdnCacheDir(REPO_ROOT)
	await mkdir(dir, { recursive: true })
	const stamp = `cdn-cache-revalidate-${Date.now()}`
	const sameUrl = `https://esm.sh/${stamp}/same.js`
	const movedUrl = `https://esm.sh/${stamp}/moved.js`
	const throwUrl = `https://esm.sh/${stamp}/throw.js`
	const status500Url = `https://esm.sh/${stamp}/status500.js`
	const headerlessUrl = `https://esm.sh/${stamp}/headerless.js`
	const pinnedUrl = `https://esm.sh/${stamp}@0.0.15/pinned.js`
	const jsdPinnedUrl = `https://cdn.jsdelivr.net/npm/${stamp}@1.2.3/other.js`
	const missUrl = `https://esm.sh/${stamp}/miss.js`
	const cachedXesm = `/${stamp}@0.0.15/es2022/x.mjs`
	const freshXesm = `/${stamp}@0.0.16/es2022/x.mjs`

	for (const [url, headers] of [
		[sameUrl, { 'content-type': 'application/javascript', 'x-esm-path': cachedXesm }],
		[movedUrl, { 'content-type': 'application/javascript', 'x-esm-path': cachedXesm }],
		[throwUrl, { 'content-type': 'application/javascript', 'x-esm-path': cachedXesm }],
		[status500Url, { 'content-type': 'application/javascript', 'x-esm-path': cachedXesm }],
		[headerlessUrl, { 'content-type': 'application/javascript', 'x-esm-path': cachedXesm }],
		[pinnedUrl, { 'content-type': 'application/javascript', 'x-esm-path': cachedXesm }],
		[jsdPinnedUrl, { 'content-type': 'application/javascript', 'x-jsd-version': '1.2.3' }],
	])
		await seedDisk(dir, url, { headers })

	const probe = fakeProbe(url => {
		if (url === movedUrl) return { ok: true, status: 200, headers: { 'x-esm-path': freshXesm } }
		if (url === throwUrl) throw new Error('probe down')
		if (url === status500Url) return { ok: false, status: 500, headers: {} }
		if (url === headerlessUrl) return { ok: true, status: 200, headers: {} }
		return { ok: true, status: 200, headers: { 'x-esm-path': cachedXesm } }
	})
	const { context, handlers } = fakeContext()
	await installCdnResponseCache(context, { probeFetch: probe.probeFetch })
	const { handler } = handlers[0]

	try {
		{
			const same = fakeRoute({ url: sameUrl })
			await handler(same.route)
			assertEquals(probe.calls.length, 1)
			assertEquals(probe.calls[0].method, 'HEAD')
			assertEquals(same.state.fetchCalls, 0)
			assertEquals(same.fulfilled[0].body.toString(), 'old')
		}

		{
			const again = fakeRoute({ url: sameUrl })
			await handler(again.route)
			assertEquals(probe.calls.length, 1)
			assertEquals(again.fulfilled[0].body.toString(), 'old')
		}

		{
			const moved = fakeRoute({
				url: movedUrl,
				/**
				 * @returns {object} mismatch 后重拉的新上游响应
				 */
				fetchImpl: () => fakeResponse({
					headers: { 'content-type': 'application/javascript', 'x-esm-path': freshXesm },
					body: 'new',
				}),
			})
			await handler(moved.route)
			assertEquals(probe.calls.length, 2)
			assertEquals(moved.state.fetchCalls, 1)
			assertEquals(moved.fulfilled[0].body.toString(), 'new')
			assertEquals(moved.fulfilled[0].headers['x-esm-path'], freshXesm)

			const after = fakeRoute({ url: movedUrl })
			await handler(after.route)
			assertEquals(probe.calls.length, 2)
			assertEquals(after.state.fetchCalls, 0)
			assertEquals(after.fulfilled[0].body.toString(), 'new')
		}

		{
			for (const url of [throwUrl, status500Url, headerlessUrl]) {
				const failOpen = fakeRoute({ url })
				await handler(failOpen.route)
				assertEquals(failOpen.state.fetchCalls, 0)
				assertEquals(failOpen.fulfilled[0].body.toString(), 'old')
			}
			assertEquals(probe.calls.length, 5)
		}

		{
			for (const url of [pinnedUrl, jsdPinnedUrl]) {
				const untouched = fakeRoute({ url })
				await handler(untouched.route)
				assertEquals(untouched.state.fetchCalls, 0)
				assertEquals(untouched.fulfilled[0].body.toString(), 'old')
			}
			assertEquals(probe.calls.length, 5)
		}

		{
			const miss = fakeRoute({
				url: missUrl,
				/**
				 * @returns {object} 未命中时抓取的上游响应
				 */
				fetchImpl: () => fakeResponse({ headers: { 'content-type': 'text/plain' }, body: 'fresh' }),
			})
			await handler(miss.route)
			assertEquals(probe.calls.length, 5)
			assertEquals(miss.state.fetchCalls, 1)
			assertEquals(miss.fulfilled[0].body.toString(), 'fresh')
		}
	}
	finally {
		clearCdnResponseMemoryCache()
		if (previousCdnCacheFlag === undefined) delete process.env.FOUNT_TEST_CDN_CACHE
		else process.env.FOUNT_TEST_CDN_CACHE = previousCdnCacheFlag
		for (const url of [sameUrl, movedUrl, throwUrl, status500Url, headerlessUrl, pinnedUrl, jsdPinnedUrl, missUrl])
			await unlink(join(dir, cacheFileName('GET', url))).catch(() => { /* may not exist */ })
	}
})

/**
 * 构造 Node fetch 风格的桩探测响应（属性取值 + arrayBuffer，走 wireProbeResponse 适配）。
 * @param {{ status?: number, headers?: Record<string, string>, body?: string }} [opts] 响应选项
 * @returns {{ status: number, headers: Record<string, string>, arrayBuffer: () => Promise<ArrayBuffer> }} 桩 Response
 */
function fakeProbeResponse({ status = 200, headers = {}, body = '' } = {}) {
	const encoded = new TextEncoder().encode(body)
	return {
		status,
		headers,
		/**
		 * @returns {Promise<ArrayBuffer>} 响应体
		 */
		arrayBuffer: async () => encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength),
	}
}

Deno.test('installCdnResponseCache: mutable urls revalidate per host policy', async () => {
	clearCdnResponseMemoryCache()
	const previousCdnCacheFlag = process.env.FOUNT_TEST_CDN_CACHE
	delete process.env.FOUNT_TEST_CDN_CACHE
	const dir = cdnCacheDir(REPO_ROOT)
	await mkdir(dir, { recursive: true })
	const stamp = `cdn-cache-generic-${Date.now()}`
	const jsdSame = `https://cdn.jsdelivr.net/npm/${stamp}/same.css`
	const jsdMoved = `https://cdn.jsdelivr.net/npm/${stamp}/moved.css`
	const jsdEtag304 = `https://cdn.jsdelivr.net/npm/${stamp}/etag304.css`
	const jsdEtag200 = `https://cdn.jsdelivr.net/npm/${stamp}/etag200.css`
	const ghUrl = `https://cdn.jsdelivr.net/gh/user/${stamp}/x.js`
	const githubUrl = `https://api.github.com/repos/x/${stamp}`
	const iconifyUrl = `https://api.iconify.design/mdi/${stamp}.svg`
	const dataJsdUrl = `https://data.jsdelivr.com/v1/packages/npm/${stamp}`
	const bareUrl = `https://api.iconify.design/${stamp}/bare.svg`
	const jsdPinned = `https://cdn.jsdelivr.net/npm/${stamp}@1.2.3/pinned.css`

	for (const [url, headers] of [
		[jsdSame, { 'content-type': 'text/css', 'x-jsd-version': '1.0.0' }],
		[jsdMoved, { 'content-type': 'text/css', 'x-jsd-version': '1.0.0' }],
		[jsdEtag304, { 'content-type': 'text/css', etag: 'W/"v1"' }],
		[jsdEtag200, { 'content-type': 'text/css', etag: 'W/"v1"' }],
		[ghUrl, { 'content-type': 'text/javascript', etag: 'W/"gh0"' }],
		[githubUrl, { 'content-type': 'application/json', etag: 'W/"gh1"' }],
		[iconifyUrl, { 'content-type': 'image/svg+xml', 'last-modified': 'Mon, 07 Sep 2026 14:17:37 GMT' }],
		[dataJsdUrl, { 'content-type': 'application/json', etag: 'W/"dj1"' }],
		[bareUrl, { 'content-type': 'text/plain' }],
		[jsdPinned, { 'content-type': 'text/css', 'x-jsd-version': '1.2.3' }],
	])
		await seedDisk(dir, url, { headers })

	const probe = fakeProbe((url, init) => {
		if (url === jsdSame) return { ok: true, status: 200, headers: { 'x-jsd-version': '1.0.0' } }
		if (url === jsdMoved) return { ok: true, status: 200, headers: { 'x-jsd-version': '2.0.0' } }
		if (url === jsdEtag304) return { status: 304, headers: { etag: 'W/"v1"' } }
		if (url === jsdEtag200) return fakeProbeResponse({
			headers: { etag: 'W/"v2"', 'content-type': 'text/css' },
			body: 'newcss',
		})
		if (url === ghUrl) return { status: 304, headers: { etag: 'W/"gh0"' } }
		if (url === githubUrl) return { status: 304, headers: { etag: 'W/"gh1"' } }
		if (url === iconifyUrl) return { status: 304, headers: { 'last-modified': 'Mon, 07 Sep 2026 14:17:37 GMT' } }
		if (url === dataJsdUrl) return { status: 304, headers: { etag: 'W/"dj1"' } }
		if (url === bareUrl) return fakeProbeResponse({
			headers: { 'content-type': 'text/plain', etag: 'W/"bare2"' },
			body: 'refetched',
		})
		throw new Error(`unexpected probe: ${url}`)
	})
	const { context, handlers } = fakeContext()
	await installCdnResponseCache(context, { probeFetch: probe.probeFetch })
	const { handler } = handlers[0]

	try {
		{
			const same = fakeRoute({ url: jsdSame })
			await handler(same.route)
			assertEquals(probe.calls.length, 1)
			assertEquals(probe.calls[0].method, 'HEAD')
			assertEquals(same.state.fetchCalls, 0)
			assertEquals(same.fulfilled[0].body.toString(), 'old')
		}

		{
			const moved = fakeRoute({
				url: jsdMoved,
				/**
				 * @returns {object} mismatch 后重拉的新上游响应
				 */
				fetchImpl: () => fakeResponse({
					headers: { 'content-type': 'text/css', 'x-jsd-version': '2.0.0' },
					body: 'v2',
				}),
			})
			await handler(moved.route)
			assertEquals(probe.calls.length, 2)
			assertEquals(moved.state.fetchCalls, 1)
			assertEquals(moved.fulfilled[0].body.toString(), 'v2')
		}

		{
			const etag304 = fakeRoute({ url: jsdEtag304 })
			await handler(etag304.route)
			const conditionalCall = probe.calls[probe.calls.length - 1]
			assertEquals(conditionalCall.method, 'GET')
			assertEquals(conditionalCall.headers['if-none-match'], 'W/"v1"')
			assertEquals(etag304.state.fetchCalls, 0)
			assertEquals(etag304.fulfilled[0].body.toString(), 'old')
		}

		{
			const etag200 = fakeRoute({ url: jsdEtag200 })
			await handler(etag200.route)
			assertEquals(etag200.state.fetchCalls, 0)
			assertEquals(etag200.fulfilled[0].body.toString(), 'newcss')

			const after = fakeRoute({ url: jsdEtag200 })
			await handler(after.route)
			assertEquals(after.fulfilled[0].body.toString(), 'newcss')
		}

		{
			for (const [url, expectedHeader, expectedValue] of [
				[ghUrl, 'if-none-match', 'W/"gh0"'],
				[githubUrl, 'if-none-match', 'W/"gh1"'],
				[dataJsdUrl, 'if-none-match', 'W/"dj1"'],
				[iconifyUrl, 'if-modified-since', 'Mon, 07 Sep 2026 14:17:37 GMT'],
			]) {
				const conditional = fakeRoute({ url })
				await handler(conditional.route)
				const call = probe.calls[probe.calls.length - 1]
				assertEquals(call.method, 'GET')
				assertEquals(call.headers[expectedHeader], expectedValue)
				assertEquals(conditional.state.fetchCalls, 0)
				assertEquals(conditional.fulfilled[0].body.toString(), 'old')
			}
		}

		{
			const bare = fakeRoute({ url: bareUrl })
			await handler(bare.route)
			const call = probe.calls[probe.calls.length - 1]
			assertEquals(call.method, 'GET')
			assertEquals(call.headers['if-none-match'], undefined)
			assertEquals(call.headers['if-modified-since'], undefined)
			assertEquals(bare.state.fetchCalls, 0)
			assertEquals(bare.fulfilled[0].body.toString(), 'refetched')
		}

		{
			const pinned = fakeRoute({ url: jsdPinned })
			await handler(pinned.route)
			assertEquals(probe.calls.length, 9)
			assertEquals(pinned.state.fetchCalls, 0)
			assertEquals(pinned.fulfilled[0].body.toString(), 'old')
		}
	}
	finally {
		clearCdnResponseMemoryCache()
		if (previousCdnCacheFlag === undefined) delete process.env.FOUNT_TEST_CDN_CACHE
		else process.env.FOUNT_TEST_CDN_CACHE = previousCdnCacheFlag
		for (const url of [
			jsdSame,
			jsdMoved,
			jsdEtag304,
			jsdEtag200,
			ghUrl,
			githubUrl,
			iconifyUrl,
			dataJsdUrl,
			bareUrl,
			jsdPinned,
		])
			await unlink(join(dir, cacheFileName('GET', url))).catch(() => { /* may not exist */ })
	}
})
