/**
 * epochCache：bump 后旧请求仍返回值，但不入 cache——initTranslations 必须用返回值而非 cache.get。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createEpochCache } from '../../../public/pages/scripts/lib/epochCache.mjs'

Deno.test('epoch cache returns load result even when bump skips cache write', async () => {
	const cache = createEpochCache()
	/** @type {(value: { bundle: object, locale: string }) => void} */
	let resolveLoad
	const loadPromise = new Promise(resolve => { resolveLoad = resolve })
	const pending = cache.get('zh-CN', () => loadPromise)
	cache.bump()
	resolveLoad({ bundle: { hello: '你好' }, locale: 'zh-CN' })
	const entry = await pending
	assertEquals(entry.locale, 'zh-CN')
	assertEquals(entry.bundle.hello, '你好')
	// 入 cache 被跳过；若 initTranslations 只 localeBundleCache.get(key) 会得到 undefined，DOM 停在旧语种
	assertEquals(cache.peek('zh-CN'), undefined)
})

Deno.test('epoch cache hit after successful load without bump', async () => {
	const cache = createEpochCache()
	const first = await cache.get('en-UK', async () => ({ bundle: { hello: 'Hello' }, locale: 'en-UK' }))
	const second = await cache.get('en-UK', async () => {
		throw new Error('load must not run on cache hit')
	})
	assertEquals(first, second)
	assertEquals(cache.peek('en-UK')?.locale, 'en-UK')
})

Deno.test('inflight dedupes concurrent gets for the same key', async () => {
	const cache = createEpochCache()
	let loads = 0
	/** @type {(value: { bundle: object, locale: string }) => void} */
	let resolveLoad
	const loadPromise = new Promise(resolve => { resolveLoad = resolve })
	const firstRequest = cache.get('ja-JP', () => { loads++; return loadPromise })
	const secondRequest = cache.get('ja-JP', () => { loads++; return loadPromise })
	resolveLoad({ bundle: { hello: 'こんにちは' }, locale: 'ja-JP' })
	assertEquals(await firstRequest, await secondRequest)
	assertEquals(loads, 1)
})
