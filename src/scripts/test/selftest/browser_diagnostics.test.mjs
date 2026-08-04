/**
 * 浏览器网络诊断聚合与噪声规则。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { detectNoiseHits } from '../core/output_filter.mjs'
import {
	BROWSER_NETWORK_PREFIX,
	I18N_MISSING_PREFIX,
	TEST_WATCH_CONSOLE_PREFIX,
	browserNetworkAggregateKey,
	formatBrowserNetworkLine,
	isI18nMissingConsoleText,
	isIgnoredBrowserNetworkError,
	isIgnoredChildFrameSecurityError,
	isTestWatchConsoleText,
	pageErrorFromCdpException,
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

Deno.test('isTestWatchConsoleText matches page watch prefix', () => {
	assertEquals(isTestWatchConsoleText(`${TEST_WATCH_CONSOLE_PREFIX}a11y] color-contrast ...`), true)
	assertEquals(isTestWatchConsoleText('plain log'), false)
})

Deno.test('isI18nMissingConsoleText matches i18n missing prefix', () => {
	assertEquals(isI18nMissingConsoleText(`${I18N_MISSING_PREFIX} Translation key "foo.bar" not found.`), true)
	assertEquals(isI18nMissingConsoleText('plain log'), false)
})

Deno.test('isIgnoredBrowserNetworkError drops ORB only', () => {
	assertEquals(isIgnoredBrowserNetworkError('net::ERR_BLOCKED_BY_ORB'), true)
	assertEquals(isIgnoredBrowserNetworkError('net::ERR_CONNECTION_REFUSED'), false)
	assertEquals(isIgnoredBrowserNetworkError(null), false)
})

Deno.test('isIgnoredChildFrameSecurityError uses exception.className + frame', () => {
	assertEquals(isIgnoredChildFrameSecurityError({
		exception: { className: 'SecurityError' },
	}, false), true)
	assertEquals(isIgnoredChildFrameSecurityError({
		exception: { className: 'SecurityError' },
	}, true), false)
	assertEquals(isIgnoredChildFrameSecurityError({
		exception: { className: 'TypeError' },
	}, false), false)
	assertEquals(isIgnoredChildFrameSecurityError({
		text: 'Uncaught SecurityError: boom',
	}, false), false)
	assertEquals(isIgnoredChildFrameSecurityError(null, false), false)
})

Deno.test('pageErrorFromCdpException uses RemoteObject + StackTrace only', () => {
	assertEquals(pageErrorFromCdpException({
		text: 'Uncaught SecurityError: boom',
		exception: {
			className: 'SecurityError',
			description: 'SecurityError: boom\n    at foo',
		},
	}), {
		name: 'SecurityError',
		stack: 'SecurityError: boom\n    at foo',
	})
	assertEquals(pageErrorFromCdpException({
		text: 'Uncaught SecurityError: should-not-parse',
		stackTrace: {
			callFrames: [{ functionName: 'go', url: 'https://x/', lineNumber: 2, columnNumber: 4 }],
		},
	}), {
		name: 'Error',
		stack: 'Error\n    at go (https://x/:3:5)',
	})
})
