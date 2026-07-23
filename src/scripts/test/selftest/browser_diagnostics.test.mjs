/**
 * 浏览器网络诊断聚合与噪声规则。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { detectNoiseHits } from '../core/output_filter.mjs'
import {
	BROWSER_NETWORK_PREFIX,
	TEST_WATCH_CONSOLE_PREFIX,
	browserNetworkAggregateKey,
	formatBrowserNetworkLine,
	isIgnoredBrowserNetworkError,
	isTestWatchConsoleText,
	recordBrowserNetworkEntry,
} from '../playwright/browser_diagnostics.mjs'

Deno.test('recordBrowserNetworkEntry aggregates identical http failures', () => {
	/** @type {Map<string, object>} */
	const aggregates = new Map()
	const entry = {
		kind: 'http',
		method: 'POST',
		status: 403,
		url: 'http://127.0.0.1:1/api/parts/shells:chat/entities/abc/heartbeat',
		error: null,
	}
	recordBrowserNetworkEntry(aggregates, entry)
	recordBrowserNetworkEntry(aggregates, entry)
	assertEquals(aggregates.size, 1)
	assertEquals([...aggregates.values()][0].count, 2)
	assertEquals(
		browserNetworkAggregateKey(entry),
		'http\tPOST\t403\thttp://127.0.0.1:1/api/parts/shells:chat/entities/abc/heartbeat\t',
	)
})

Deno.test('recordBrowserNetworkEntry keeps distinct requestfailed separate', () => {
	/** @type {Map<string, object>} */
	const aggregates = new Map()
	recordBrowserNetworkEntry(aggregates, {
		kind: 'requestfailed',
		method: 'GET',
		status: null,
		url: 'http://127.0.0.1:1/a',
		error: 'net::ERR_CONNECTION_REFUSED',
	})
	recordBrowserNetworkEntry(aggregates, {
		kind: 'requestfailed',
		method: 'GET',
		status: null,
		url: 'http://127.0.0.1:1/b',
		error: 'net::ERR_CONNECTION_REFUSED',
	})
	assertEquals(aggregates.size, 2)
})

Deno.test('formatBrowserNetworkLine uses stable prefix and JSON body', () => {
	const line = formatBrowserNetworkLine({
		kind: 'http',
		method: 'GET',
		status: 404,
		url: 'http://127.0.0.1:1/missing',
		error: null,
		count: 3,
	})
	assertEquals(line.startsWith(`${BROWSER_NETWORK_PREFIX} `), true)
	assertEquals(JSON.parse(line.slice(BROWSER_NETWORK_PREFIX.length + 1)), {
		kind: 'http',
		method: 'GET',
		status: 404,
		url: 'http://127.0.0.1:1/missing',
		error: null,
		count: 3,
	})
})

Deno.test('detectNoiseHits marks browser:network as browser_network', () => {
	const line = formatBrowserNetworkLine({
		kind: 'http',
		method: 'POST',
		status: 403,
		url: 'http://127.0.0.1:1/heartbeat',
		error: null,
		count: 1,
	})
	assertEquals(detectNoiseHits(line), ['browser_network'])
	assertEquals(detectNoiseHits('ok\n[browser:http] 403 http://x\n'), [])
	assertEquals(detectNoiseHits('all green'), [])
})

Deno.test('isTestWatchConsoleText matches test_watch prefix', () => {
	assertEquals(isTestWatchConsoleText(`${TEST_WATCH_CONSOLE_PREFIX}a11y] color-contrast ...`), true)
	assertEquals(isTestWatchConsoleText('plain log'), false)
})

Deno.test('isIgnoredBrowserNetworkError drops ORB only', () => {
	assertEquals(isIgnoredBrowserNetworkError('net::ERR_BLOCKED_BY_ORB'), true)
	assertEquals(isIgnoredBrowserNetworkError('net::ERR_CONNECTION_REFUSED'), false)
	assertEquals(isIgnoredBrowserNetworkError(null), false)
})
