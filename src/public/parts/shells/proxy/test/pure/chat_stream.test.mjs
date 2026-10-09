/* global Deno */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { createFetchChatCompletionWithRetry } from '../../../../serviceGenerators/AI/proxy/src/chatCompletion.mjs'
import { mockJsonFetch, openaiMessageResponse } from '../../../../serviceGenerators/AI/proxy/test/mockFetch.mjs'
import { createChatCompletionStream } from '../../src/chatStream.mjs'

/** @returns {void} Do not persist mock configuration. */
function saveConfig() { }

/**
 * @returns {object} SSE recorder and transport callbacks.
 */
function recorder() {
	const frames = []
	const output = createChatCompletionStream({
		/**
		 * @param {string} data SSE frame.
		 * @returns {void} Record the frame.
		 */
		write: data => { frames.push(data) },
		id: 'id', created: 123, model: 'mock', restartMessage: '重新生成', failureMessage: '再次重复，已停止',
	})
	return {
		frames, output,
		/** @returns {object[]} Parsed JSON frames (excluding DONE). */
		json: () => frames.filter(frame => !frame.includes('[DONE]')).map(frame => JSON.parse(frame.slice(6))),
	}
}

Deno.test('proxy streaming marks the retry and sends a shorter replacement from its first character', () => {
	const { frames, output, json } = recorder()
	output.replyPreviewUpdater({ content: '第一段比较长的已发送答案' })
	output.onGenerationRestart()
	output.replyPreviewUpdater({ content: '' })
	output.replyPreviewUpdater({ content: '新' })
	output.replyPreviewUpdater({ content: '新答案' })
	output.finish({ content: '新答案' })
	const chunks = json()
	assertEquals(chunks.map(chunk => chunk.choices[0].delta.content ?? '').join(''), '第一段比较长的已发送答案\n\n---\n重新生成\n\n新答案')
	assertEquals(chunks.filter(chunk => chunk.choices[0].delta.role === 'assistant').length, 1)
	assertEquals(chunks.at(-1).choices[0].finish_reason, 'stop')
	assertEquals(frames.at(-1), 'data: [DONE]\n\n')
})

Deno.test('proxy sends final content when an upstream source provides no previews', () => {
	const { output, json } = recorder()
	output.finish({ content: '完整非流式回答' })
	assertEquals(json()[0].choices[0].delta.content, '完整非流式回答')
})

Deno.test('proxy repeated failure sends an error and never a successful stop', async () => {
	const { frames, output, json } = recorder()
	const mock = mockJsonFetch(() => openaiMessageResponse('泥水'.repeat(150)))
	const call = createFetchChatCompletionWithRetry({ url: 'https://example.com/v1/chat/completions', api_mode: 'chat', model: 'mock', use_stream: false }, { SaveConfig: saveConfig })
	try {
		try {
			const result = await call([{ role: 'user', content: 'test' }], { previewUpdater: output.replyPreviewUpdater, onGenerationRestart: output.onGenerationRestart })
			output.finish(result)
		} catch (error) { output.fail(error) }
		assertEquals(mock.calls.length, 2)
		assertStringIncludes(frames.join(''), '重新生成')
		assertStringIncludes(frames.join(''), '再次重复，已停止')
		assertEquals(json().at(-1).error.code, 'output_degenerated')
		assertEquals(json().some(frame => frame.choices?.[0]?.finish_reason === 'stop'), false)
	} finally { mock.restore() }
})
