/**
 * isTransientNetError 判定钉死：Playwright 跨进程错误只保留 message 首行结构，
 * 按首行精确 token 匹配 node errno / premature close，Call log 内的偶合词不得误判。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { isTransientNetError } from '../playwright/transient_error.mjs'

/**
 * 构造带 Call log 的 Playwright 错误 message（跨进程序列化的真实形状）。
 * @param {string} tail 首行错误尾部
 * @returns {string} 完整错误 message
 */
const messageWithCallLog = tail =>
	`apiRequestContext.post: ${tail}\nCall log:\n  - → POST http://localhost:28935/x`

Deno.test('isTransientNetError', async test => {
	await test.step('real errno shapes match', () => {
		assertEquals(isTransientNetError(new Error(messageWithCallLog('read ECONNRESET'))), true)
		assertEquals(isTransientNetError(new Error(messageWithCallLog('connect ECONNREFUSED 127.0.0.1:1'))), true)
		assertEquals(isTransientNetError(new Error(messageWithCallLog('write EPIPE'))), true)
		assertEquals(isTransientNetError(new Error(messageWithCallLog('socket hang up'))), true)
	})

	await test.step('non-network errors do not match', () => {
		assertEquals(isTransientNetError(new Error('viewer failed: 500')), false)
		assertEquals(isTransientNetError(new Error('create pack failed: 400')), false)
	})

	await test.step('keywords inside call log / non-first-line do not match', () => {
		assertEquals(
			isTransientNetError(new Error('apiRequestContext.get: Unexpected status 404 /api/econnreset-trap\nCall log:\n  - → GET http://x/econnreset')),
			false,
		)
		assertEquals(isTransientNetError(new Error(`apiRequestContext.post: ok\nCall log:\n${messageWithCallLog('read ECONNRESET')}`)), false)
	})

	await test.step('lowercase text is not an errno token', () => {
		assertEquals(isTransientNetError(new Error(messageWithCallLog('read econnreset'))), false)
	})

	await test.step('non-error values do not match', () => {
		assertEquals(isTransientNetError('apiRequestContext.post: read ECONNRESET'), false)
		assertEquals(isTransientNetError(undefined), false)
	})
})
