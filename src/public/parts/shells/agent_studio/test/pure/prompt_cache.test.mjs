/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { commonPrefixLength, estimateGenerationCache, estimatePromptCache, serializeRequest } from '../../public/shared/promptCache.mjs'

Deno.test('estimates contiguous prompt reuse across generations without claiming usage for expired snapshots', () => {
	const rates = estimatePromptCache([
		{ requests: [{ systemPrompt: 'instruction', messages: [{ role: 'user', content: 'hello' }] }] },
		{ requests: [{ systemPrompt: 'instruction', messages: [{ role: 'user', content: 'hello world' }] }] },
		{ requestCount: 1, requestsStripped: true },
	])
	assertEquals(rates[0].rate, null)
	assertEquals(rates[1].rate > 0.6, true)
	assertEquals(rates[2].rate, null)
})

Deno.test('estimatePromptCache exposes per-round rates aligned with each generation request', () => {
	const metrics = estimatePromptCache([
		{ requests: [
			{ systemPrompt: 'instruction', messages: [{ role: 'user', content: 'hello' }] },
			{ systemPrompt: 'instruction', messages: [{ role: 'user', content: 'hello world' }] },
			{ systemPrompt: 'instruction', messages: [{ role: 'user', content: 'hello world!' }] },
		] },
		{ requests: [{ systemPrompt: 'instruction', messages: [{ role: 'user', content: 'hello world!' }] }] },
	])
	assertEquals(metrics[0].rounds.length, 3)
	assertEquals(metrics[0].rounds[0].rate, null)
	assertEquals(metrics[0].rounds[1].rate > 0.7, true)
	assertEquals(metrics[0].rounds[2].rate > 0.9, true)
	assertEquals(metrics[1].rounds.length, 1)
	assertEquals(metrics[1].rounds[0].rate, 1)
	// 生成的汇总率取各轮复用率的算术平均
	assertEquals(metrics[0].rate > 0.8, true)
})

Deno.test('serializeRequest prefers the built snapshot text over systemPrompt + messages', () => {
	assertEquals(
		serializeRequest({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }], snapshot: 'built-prompt' }),
		'built-prompt',
	)
	assertEquals(
		serializeRequest({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }] }),
		'sys\nuser\nhi',
	)
})

Deno.test('estimateGenerationCache compares the first request against the supplied previous prompt', () => {
	const request = { systemPrompt: 'instruction', messages: [{ role: 'user', content: 'hello world' }] }
	const previous = serializeRequest({ systemPrompt: 'instruction', messages: [{ role: 'user', content: 'hello' }] })
	const metric = estimateGenerationCache(previous, [request])
	assertEquals(metric.rate > 0.6, true)
	assertEquals(estimateGenerationCache(null, [request]).rate, null)
	assertEquals(estimateGenerationCache(previous, []).rate, null)
})

Deno.test('estimatePromptCache averages per-round rates instead of diluting by summed lengths', () => {
	// 第二个请求以第一个为前缀
	const metrics = estimatePromptCache([{
		requests: [
			{ systemPrompt: 'sys', messages: [{ role: 'user', content: 'hello' }] },
			{ systemPrompt: 'sys', messages: [{ role: 'user', content: 'hello' }, { role: 'char', content: 'hi there' }] },
		],
	}])
	assertEquals(metrics[0].rounds[0].rate, null)
	assertEquals(metrics[0].rounds[1].rate > 0.4, true)
	// 纯追加时上一请求被完整复用，该轮即 100%
	assertEquals(metrics[0].rounds[1].rate, 1)
	assertEquals(metrics[0].rate, metrics[0].rounds[1].rate)
})

Deno.test('estimateGenerationCache averages per-round rates', () => {
	const previous = serializeRequest({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'hello' }] })
	const metric = estimateGenerationCache(previous, [
		{ systemPrompt: 'sys', messages: [{ role: 'user', content: 'hello' }, { role: 'char', content: 'hi there' }] },
	])
	assertEquals(metric.rate, metric.reused / metric.total)
})

Deno.test('a fully-reused previous prompt counts as 100% even when large content is appended', () => {
	const base = { systemPrompt: 'instruction', messages: [{ role: 'user', content: 'X'.repeat(200) }] }
	const appended = {
		systemPrompt: 'instruction',
		messages: [{ role: 'user', content: 'X'.repeat(200) }, { role: 'char', content: 'Y'.repeat(114514) }],
	}
	const metrics = estimatePromptCache([{ requests: [base, appended] }])
	assertEquals(metrics[0].rounds[1].rate, 1)
	assertEquals(metrics[0].rate, 1)
	assertEquals(estimateGenerationCache(serializeRequest(base), [appended]).rate, 1)
})

Deno.test('reuse rate is normalized by the previous prompt, not the current one', () => {
	const base = { systemPrompt: 'sys', messages: [{ role: 'user', content: 'hello' }] }
	const shorter = { systemPrompt: 'sys', messages: [] }
	const metrics = estimatePromptCache([{ requests: [base, shorter] }])
	// 上一请求 14 字符、本轮 3 字符：只有 3 字符可作为前缀复用
	assertEquals(metrics[0].rounds[1].rate, 3 / 14)
})

Deno.test('serializeRequest and commonPrefixLength expose the character-level basis', () => {
	const serialized = serializeRequest({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }] })
	assertEquals(serialized, 'sys\nuser\nhi')
	assertEquals(commonPrefixLength('abcd', 'abef'), 2)
	assertEquals(commonPrefixLength('', 'ab'), 0)
})
