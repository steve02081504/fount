/* global Deno */
import { assertEquals, assertRejects } from 'jsr:@std/assert'

import { createFetchChatCompletionWithRetry } from '../../src/chatCompletion.mjs'
import { AIOutputDegenerationError } from '../../src/outputGuard.mjs'
import { OUTPUT_RECOVERY_PROMPT } from '../../src/outputRecovery.mjs'
import { mockJsonFetch, openaiMessageResponse, responsesOutputResponse } from '../mockFetch.mjs'

/**
 * @param {object} [config] Request overrides.
 * @returns {Function} Guarded model request.
 */
function makeCall(config = {}) {
	return createFetchChatCompletionWithRetry({ url: 'https://example.com/v1/chat/completions', api_mode: 'auto', model: 'mock', use_stream: true, ...config }, { SaveConfig: saveConfig })
}

/** @returns {void} Do not persist mock configuration. */
function saveConfig() { }

/**
 * @param {object[]} events SSE payloads.
 * @param {Function} [cancel] Open stream cancellation callback.
 * @returns {Response} Mock upstream stream.
 */
function streamResponse(events, cancel) {
	return new Response(new ReadableStream({
		/**
		 * @param {ReadableStreamDefaultController<Uint8Array>} controller Mock upstream stream.
		 * @returns {void} Enqueue events and optionally leave the stream open.
		 */
		start(controller) {
			for (const event of events) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
			if (!cancel) controller.close()
		},
		cancel,
	}), { headers: { 'Content-Type': 'text/event-stream' } })
}

Deno.test('chat stops an open repeating stream and returns only the second answer with both usage calls', async () => {
	let cancelled = 0
	let count = 0
	const mock = mockJsonFetch(() => ++count === 1
		? streamResponse([
			{ usage: { prompt_tokens: 10, completion_tokens: 40 }, choices: [] },
			{ choices: [{ delta: { content: '初步回答。', reasoning_content: '最初的思考' }, logprobs: { content: [{ token: '初' }] } }] },
			{ choices: [{ delta: { content: '泥水'.repeat(80) } }] },
		], () => { cancelled++ })
		: streamResponse([{ usage: { prompt_tokens: 20, completion_tokens: 5 }, choices: [{ delta: { content: '第二次的正常答案' } }] }]))
	const messages = [{ role: 'user', content: '请回答原问题' }]
	const result = {
		content: '', files: [{ name: 'prior.txt' }],
		extension: { marker: true, reasoning_content: 'previous round', logprobs: { content: [{ token: 'previous' }] }, logprobs_metrics: { tokensCount: 1 }, outputRecovery: { attempts: 2 } },
	}
	const previews = []
	const restarts = []
	try {
		const returned = await makeCall({ model_arguments: { logprobs: true } })(messages, {
			result,
			/**
			 * @param {object} partial Raw preview snapshot.
			 * @returns {void} Record text before rendering.
			 */
			previewUpdater: partial => { previews.push(partial.content) },
			/**
			 * @param {object} info Restart reason.
			 * @returns {void} Record restart notification.
			 */
			onGenerationRestart: info => { restarts.push(info) },
		})
		assertEquals(returned, result)
		assertEquals(result.content, '第二次的正常答案')
		assertEquals(result.files, [{ name: 'prior.txt' }])
		assertEquals(result.extension.reasoning_content, undefined)
		assertEquals(result.extension.logprobs, undefined)
		assertEquals(result.extension.logprobs_metrics, undefined)
		assertEquals(result.extension.marker, true)
		assertEquals(result.extension.usage.calls.length, 2)
		assertEquals(result.extension.usage.total.outputTokens, 45)
		assertEquals(result.extension.modelCalls.map(call => call.status), ['aborted', 'succeeded'])
		assertEquals(result.extension.modelCalls[0].stopReason, 'output_degenerated')
		assertEquals(result.extension.outputRecovery.attempts, 2)
		assertEquals(cancelled, 1)
		assertEquals(mock.calls[0].init.signal.aborted, true)
		assertEquals(mock.calls[1].init.signal.aborted, false)
		assertEquals(JSON.parse(mock.calls[1].init.body).messages, [...messages, { role: 'system', content: OUTPUT_RECOVERY_PROMPT }])
		assertEquals(messages.length, 1)
		assertEquals(previews, ['初步回答。', '', '第二次的正常答案'])
		assertEquals(restarts, [{ attempt: 2, reason: 'output_degenerated' }])
	} finally { mock.restore() }
})

Deno.test('two repeating answers throw the original typed failure without endpoint fallback', async () => {
	const mock = mockJsonFetch(() => openaiMessageResponse('好吃太'.repeat(200)))
	const result = { content: '', files: [] }
	try {
		const error = await assertRejects(() => makeCall({ use_stream: false })([{ role: 'user', content: 'test' }], { result }), AIOutputDegenerationError)
		assertEquals(error.code, 'output_degenerated')
		assertEquals(mock.calls.length, 2)
		assertEquals(new Set(mock.calls.map(call => call.url)).size, 1)
		assertEquals(result.extension.outputRecovery.incidents.length, 2)
	} finally { mock.restore() }
})

Deno.test('Responses reasoning summary loops are repaired without carrying failed reasoning', async () => {
	let count = 0
	const mock = mockJsonFetch(() => ++count === 1
		? streamResponse([{ type: 'response.reasoning_summary_text.delta', summary_index: 0, delta: '让我再确认这个假设是否正确。'.repeat(80) }], () => { })
		: streamResponse([{ type: 'response.output_text.delta', delta: '正常回答' }]))
	try {
		const result = await makeCall({ api_mode: 'responses', url: 'https://example.com/v1/responses' })([{ role: 'user', content: 'test' }])
		assertEquals(result.content, '正常回答')
		assertEquals(result.extension.reasoning_summary, undefined)
		assertEquals(JSON.parse(mock.calls[1].init.body).input.at(-1), { type: 'message', role: 'system', content: OUTPUT_RECOVERY_PROMPT })
	} finally { mock.restore() }
})

Deno.test('Responses nonstream and completed snapshot outputs are guarded too', async () => {
	for (const use_stream of [false, true]) {
		let count = 0
		const mock = mockJsonFetch(() => use_stream
			? streamResponse([{ type: 'response.completed', response: { output_text: ++count === 1 ? '泥水'.repeat(150) : '完成' } }])
			: responsesOutputResponse(++count === 1 ? '泥水'.repeat(150) : '完成'))
		try {
			assertEquals((await makeCall({ api_mode: 'responses', url: 'https://example.com/v1/responses', use_stream })([{ role: 'user', content: 'test' }])).content, '完成')
			assertEquals(mock.calls.length, 2)
		} finally { mock.restore() }
	}
})

Deno.test('endpoint discovery does not wrap degeneration into an aggregate error', async () => {
	const originalWarn = console.warn
	/**
	 * @returns {void} Silence expected endpoint-discovery notices.
	 */
	console.warn = () => { }
	let count = 0
	const mock = mockJsonFetch(({ url }) => {
		if (url.endsWith('/chat/completions')) return new Response('not found', { status: 404 })
		return responsesOutputResponse(++count === 1 ? '泥水'.repeat(150) : '完成')
	})
	try {
		assertEquals((await makeCall({ use_stream: false })([{ role: 'user', content: 'test' }])).content, '完成')
		assertEquals(mock.calls.length, 4)
	} finally { mock.restore(); console.warn = originalWarn }
})

Deno.test('user cancellation at restart prevents the second request', async () => {
	const controller = new AbortController()
	const result = { content: '', files: [] }
	const mock = mockJsonFetch(() => openaiMessageResponse('泥水'.repeat(150)))
	try {
		const options = {
			signal: controller.signal,
			result,
			/** @returns {void} Cancel before retrying. */
			onGenerationRestart: () => controller.abort(),
		}
		const error = await assertRejects(() => makeCall({ use_stream: false })([{ role: 'user', content: 'test' }], options))
		assertEquals(error.name, 'AbortError')
		assertEquals(mock.calls.length, 1)
		assertEquals(result.extension.outputRecovery.attempts, 1)
	} finally { mock.restore() }
})

Deno.test('repair remains cancellable during the second stream and never starts a third request', async () => {
	const controller = new AbortController()
	let count = 0
	let cancelled = false
	const mock = mockJsonFetch(() => ++count === 1
		? openaiMessageResponse('泥水'.repeat(150))
		: streamResponse([{ choices: [{ delta: { content: '修正中的输出' } }] }], () => { cancelled = true }))
	try {
		const options = {
			signal: controller.signal,
			/**
			 * @param {object} partial Current snapshot.
			 * @returns {void} Cancel during the replacement stream.
			 */
			previewUpdater: partial => { if (partial.content === '修正中的输出') controller.abort() },
		}
		const error = await assertRejects(() => makeCall()([{ role: 'user', content: 'test' }], options))
		assertEquals(error.name, 'AbortError')
		assertEquals(mock.calls.length, 2)
		assertEquals(cancelled, true)
	} finally { mock.restore() }
})

Deno.test('explicitly disabled detection permits intentional repetition without a retry', async () => {
	const repeated = '泥水'.repeat(150)
	const mock = mockJsonFetch(() => openaiMessageResponse(repeated))
	try {
		assertEquals((await makeCall({ use_stream: false, output_recovery: false })([{ role: 'user', content: 'repeat' }])).content, repeated)
		assertEquals(mock.calls.length, 1)
	} finally { mock.restore() }
})

Deno.test('concurrent generations on one source have independent cancellation and retry state', async () => {
	let repairCalls = 0
	const mock = mockJsonFetch(({ init }) => {
		const messages = JSON.parse(init.body).messages
		if (messages[0].content === 'needs-repair') return openaiMessageResponse(++repairCalls === 1 ? '泥水'.repeat(150) : 'repaired')
		return openaiMessageResponse('other-request')
	})
	try {
		const call = makeCall({ use_stream: false })
		const [repaired, other] = await Promise.all([
			call([{ role: 'user', content: 'needs-repair' }]),
			call([{ role: 'user', content: 'independent' }]),
		])
		assertEquals(repaired.content, 'repaired')
		assertEquals(other.content, 'other-request')
		assertEquals(other.extension.outputRecovery, undefined)
		assertEquals(other.extension.modelCalls.length, 1)
		assertEquals(mock.calls.length, 3)
	} finally { mock.restore() }
})
