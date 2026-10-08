/* global Deno */
import { assertAlmostEquals, assertEquals } from 'jsr:@std/assert'

import { priceUsage } from '../../../../../shells/chat/public/shared/usage.mjs'
import { createFetchChatCompletionWithRetry } from '../../src/chatCompletion.mjs'
import { createUsageRecorder, normalizeUsage } from '../../src/usage.mjs'
import { mockJsonFetch } from '../mockFetch.mjs'

Deno.test('Anthropic cumulative stream snapshots preserve input and replace output', () => {
	const result = {}
	const recorder = createUsageRecorder(result, { model: 'claude' }, 'anthropic')
	recorder.record({ input_tokens: 12, cache_read_input_tokens: 100, cache_creation_input_tokens: 50, output_tokens: 1 }, 'resolved-claude')
	recorder.record({ output_tokens: 8 })
	recorder.record({ output_tokens: 8 })
	recorder.apply()
	assertEquals(result.extension.usage.calls.length, 1)
	assertEquals(result.extension.usage.calls[0].model, 'resolved-claude')
	assertEquals(result.extension.usage.total, { inputTokens: 162, cacheReadTokens: 100, cacheWriteTokens: 50, outputTokens: 8 })
	const second = createUsageRecorder(result, { model: 'claude' }, 'anthropic')
	second.record({ input_tokens: 10, output_tokens: 4 })
	second.apply()
	assertEquals(result.extension.usage.calls.length, 2)
	assertEquals(result.extension.usage.total.inputTokens, 172)
})

Deno.test('partial token details preserve cached input and reasoning across stream reports', () => {
	const result = {}
	const recorder = createUsageRecorder(result, { model: 'test' })
	recorder.record({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 2 } })
	recorder.record({ prompt_tokens_details: { cache_write_tokens: 10 }, completion_tokens_details: { accepted_prediction_tokens: 1 } })
	recorder.apply()
	assertEquals(result.extension.usage.total, { inputTokens: 100, cacheReadTokens: 20, cacheWriteTokens: 10, outputTokens: 5, reasoningTokens: 2 })
	assertEquals(result.extension.usage.calls.length, 1)
})

Deno.test('a recorder that saw no usable count leaves the reply unmetered', () => {
	const result = {}
	createUsageRecorder(result, { model: 'claude' }, 'anthropic').apply()
	assertEquals(result.extension, undefined)
	const empty = {}
	const recorder = createUsageRecorder(empty, { model: 'claude' }, 'anthropic')
	recorder.record(undefined)
	recorder.apply()
	assertEquals(empty.extension, undefined)
})

Deno.test('provider normalization keeps inclusive input and reasoning output', () => {
	assertEquals(normalizeUsage({ inputTokens: 28, cacheReadInputTokens: 1898, cacheWriteInputTokens: 0, outputTokens: 294 }, 'bedrock').inputTokens, 1926)
	assertEquals(normalizeUsage({ promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 10 }, 'gemini').outputTokens, 30)
	assertEquals(normalizeUsage({ prompt_tokens: 100, completion_tokens: 20 }).cacheReadTokens, undefined)
})

Deno.test('cost requires configured rates and sufficient known categories', () => {
	const call = { inputTokens: 100, outputTokens: 10 }
	assertEquals(priceUsage(call).cost, undefined)
	assertEquals(priceUsage(call, { currency: 'USD', input: 1, output: 2 }).cost, undefined)
	assertEquals(priceUsage(call, { currency: 'USD', input: 1, cacheRead: 1, cacheWrite: 1, output: 2 }).cost, 0.00012)
	assertAlmostEquals(priceUsage({ ...call, cacheReadTokens: 20, cacheWriteTokens: 10 }, { currency: 'USD', input: 1, cacheRead: 0.1, cacheWrite: 2, output: 3 }).cost, 0.000122)
	assertAlmostEquals(priceUsage({ ...call, cacheReadTokens: 20 }, { currency: 'USD', input: 1, cacheRead: 0.1, cacheWrite: 1, output: 3 }).cost, 0.000112)
	assertEquals(priceUsage({ ...call, cacheReadTokens: 0, cacheWriteTokens: 0 }, { currency: 'USD', input: 1, cacheRead: NaN, output: 2 }).cost, 0.00012)
	assertEquals(priceUsage({ ...call, inputTokens: NaN, cacheReadTokens: 0, cacheWriteTokens: 0 }, { currency: 'USD', input: 1, output: 2 }).cost, undefined)
})

Deno.test('the actual model survives a stream frame without usage', () => {
	const result = {}
	const recorder = createUsageRecorder(result, { model: 'alias' })
	recorder.record(undefined, 'resolved-model')
	recorder.record({ prompt_tokens: 1, completion_tokens: 2 })
	recorder.apply()
	assertEquals(result.extension.usage.calls[0].model, 'resolved-model')
})

for (const api_mode of ['chat', 'responses']) Deno.test(`actual ${api_mode} request records usage-only final stream event`, async () => {
	const events = api_mode === 'chat' ? [
		{ choices: [{ delta: { content: 'hello' } }] },
		{ choices: [], usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 80 } } },
	] : [
		{ type: 'response.output_text.delta', delta: 'hello' },
		{ type: 'response.completed', response: { usage: { input_tokens: 100, output_tokens: 5, input_tokens_details: { cached_tokens: 80 } } } },
	]
	const mock = mockJsonFetch(() => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }))
	try {
		const run = createFetchChatCompletionWithRetry({ url: 'https://example.com/v1', api_mode, model: 'mock', use_stream: true }, {
			/** 忽略配置保存。 */
			SaveConfig: () => {},
		})
		const result = await run([{ role: 'user', content: 'hi' }])
		assertEquals(result.content, 'hello')
		assertEquals(result.extension.usage.total, { inputTokens: 100, cacheReadTokens: 80, cacheWriteTokens: 0, outputTokens: 5 })
		assertEquals(result.extension.usage.calls.length, 1)
	}
	finally { mock.restore() }
})
