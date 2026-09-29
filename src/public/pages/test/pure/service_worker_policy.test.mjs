/**
 * Service Worker 路由决策纯函数测试。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import {
	isCacheFirstExemptUrl,
	isColdBootMarkedRequest,
	isColdBootNavigationRequest,
	shouldCacheResponse,
} from '../../service_worker_policy.mjs'

const ORIGIN = 'https://fount.local'

/**
 * 构造请求对象。
 * @param {string} mode - 请求 mode。
 * @param {string} [method] - 请求方法。
 * @returns {{ mode: string, method: string }} 请求对象。
 */
function request(mode, method = 'GET') {
	return { mode, method }
}

Deno.test('isColdBootNavigationRequest rejects non-navigate GET on root path', () => {
	const url = new URL('/', ORIGIN)
	assertEquals(isColdBootNavigationRequest({ request: request('cors'), url, origin: ORIGIN }), false)
	assertEquals(isColdBootNavigationRequest({ request: request('no-cors'), url, origin: ORIGIN }), false)
	assertEquals(isColdBootNavigationRequest({ request: request('same-origin'), url, origin: ORIGIN }), false)
})

Deno.test('isColdBootNavigationRequest rejects cross-origin navigation', () => {
	const url = new URL('https://evil.example/', ORIGIN)
	assertEquals(isColdBootNavigationRequest({ request: request('navigate'), url, origin: ORIGIN }), false)
})

Deno.test('isColdBootNavigationRequest accepts same-origin navigation to root or index', () => {
	assertEquals(isColdBootNavigationRequest({ request: request('navigate'), url: new URL('/', ORIGIN), origin: ORIGIN }), true)
	assertEquals(isColdBootNavigationRequest({ request: request('navigate'), url: new URL('/index.html', ORIGIN), origin: ORIGIN }), true)
})

Deno.test('isColdBootNavigationRequest accepts same-origin navigation with cold_bootting=true', () => {
	const url = new URL('/?cold_bootting=true', ORIGIN)
	assertEquals(isColdBootNavigationRequest({ request: request('navigate'), url, origin: ORIGIN }), true)
})

Deno.test('isColdBootNavigationRequest rejects cold_bootting marked non-navigation or non-true', () => {
	assertEquals(isColdBootNavigationRequest({ request: request('cors'), url: new URL('/?cold_bootting=true', ORIGIN), origin: ORIGIN }), false)
	assertEquals(isColdBootNavigationRequest({ request: request('navigate'), url: new URL('/parts/x?cold_bootting=false', ORIGIN), origin: ORIGIN }), false)
})

Deno.test('isColdBootNavigationRequest ignores navigation to non-root path without marker', () => {
	const url = new URL('/parts/shells:chat/hub', ORIGIN)
	assertEquals(isColdBootNavigationRequest({ request: request('navigate'), url, origin: ORIGIN }), false)
})

Deno.test('isCacheFirstExemptUrl exempts api, ws and virtual_files', () => {
	assertEquals(isCacheFirstExemptUrl(new URL('/api/parts/shells:chat/state', ORIGIN)), true)
	assertEquals(isCacheFirstExemptUrl(new URL('/api', ORIGIN)), true)
	assertEquals(isCacheFirstExemptUrl(new URL('/ws/notify', ORIGIN)), true)
	assertEquals(isCacheFirstExemptUrl(new URL('/ws', ORIGIN)), true)
	assertEquals(isCacheFirstExemptUrl(new URL('/virtual_files/a/b', ORIGIN)), true)
	assertEquals(isCacheFirstExemptUrl(new URL('/virtual_files', ORIGIN)), true)
})

Deno.test('isCacheFirstExemptUrl does not exempt static or shell pages', () => {
	assertEquals(isCacheFirstExemptUrl(new URL('/favicon.ico', ORIGIN)), false)
	assertEquals(isCacheFirstExemptUrl(new URL('/parts/shells:chat/hub', ORIGIN)), false)
	assertEquals(isCacheFirstExemptUrl(new URL('/apiary', ORIGIN)), false)
})

Deno.test('shouldCacheResponse refuses authenticated and cold-boot marked responses', () => {
	assertEquals(shouldCacheResponse({ request: request('cors'), url: new URL('/api/whoami', ORIGIN) }), false)
	assertEquals(shouldCacheResponse({ request: request('cors'), url: new URL('/ws/notify', ORIGIN) }), false)
	assertEquals(shouldCacheResponse({ request: request('cors'), url: new URL('/virtual_files/a', ORIGIN) }), false)
	assertEquals(shouldCacheResponse({ request: request('navigate'), url: new URL('/?cold_bootting=true', ORIGIN) }), false)
})

Deno.test('shouldCacheResponse caches same-origin static GETs', () => {
	assertEquals(shouldCacheResponse({ request: request('cors'), url: new URL('/static/app.js', ORIGIN) }), true)
})

Deno.test('shouldCacheResponse refuses non-GET requests', () => {
	assertEquals(shouldCacheResponse({ request: request('cors', 'POST'), url: new URL('/static/app.js', ORIGIN) }), false)
})

Deno.test('isColdBootMarkedRequest reads the cold_bootting marker', () => {
	assertEquals(isColdBootMarkedRequest(new URL('/?cold_bootting=true', ORIGIN)), true)
	assertEquals(isColdBootMarkedRequest(new URL('/?cold_bootting=false', ORIGIN)), true)
	assertEquals(isColdBootMarkedRequest(new URL('/', ORIGIN)), false)
})
