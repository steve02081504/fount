/* global Deno */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import generator from '../../main.mjs'
import { OUTPUT_RECOVERY_PROMPT } from '../../src/outputRecovery.mjs'
import { mockJsonFetch, openaiMessageResponse } from '../mockFetch.mjs'

/** @returns {void} Do not persist mock source configuration. */
function saveConfig() { }

Deno.test('StructCall replaces a failed reasoning preview and leaves the original prompt snapshot unchanged', async () => {
	const config = await generator.interfaces.serviceGenerator.GetConfigTemplate()
	Object.assign(config, { url: 'https://example.com/v1/chat/completions', api_mode: 'chat', model: 'mock' })
	const source = await generator.interfaces.serviceGenerator.GetSource(config, { SaveConfig: saveConfig })
	const conversation = createPromptStructConversation()
	conversation.addUser('请直接回答原问题')
	const prompt = conversation.makePromptStruct()
	const snapshot = await source.BuildPrompt(prompt)
	let requests = 0
	const mock = mockJsonFetch(() => ++requests === 1
		? new Response([
			{ usage: { prompt_tokens: 10, completion_tokens: 50 }, choices: [{ delta: { content: '最初回答', reasoning_content: '第一次的思考' } }] },
			{ choices: [{ delta: { reasoning_content: '泥水'.repeat(80) } }] },
		].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
		: openaiMessageResponse('修正后的回答'))
	const base_result = { content: '上一工具轮', files: [], content_for_show: '', extension: { marker: 'keep' } }
	const previews = []
	const restarts = []
	try {
		const result = await source.StructCall(prompt, {
			base_result,
			supported_functions: { html: true },
			/**
			 * @param {object} partial Rendered preview snapshot.
			 * @returns {void} Capture immutable display text.
			 */
			replyPreviewUpdater(partial) { previews.push(partial.content_for_show ?? partial.content) },
			/**
			 * @param {object} info Source restart notification.
			 * @returns {void} Record the replacement boundary.
			 */
			onGenerationRestart(info) { restarts.push(info) },
		})
		assertEquals(result, base_result)
		assertEquals(result.content, '修正后的回答')
		assertEquals(result.content_for_show, undefined)
		assertEquals(result.extension.reasoning_content, undefined)
		assertEquals(result.extension.marker, 'keep')
		assertEquals(result.extension.usage.calls.length, 1)
		assertEquals(result.extension.modelCalls.length, 2)
		assertStringIncludes(previews[0], '第一次的思考')
		assertEquals(previews.at(-1), '')
		assertEquals(restarts, [{ attempt: 2, reason: 'output_degenerated' }])
		assertEquals(await source.BuildPrompt(prompt), snapshot)
		const retry = JSON.parse(mock.calls[1].init.body).messages
		assertEquals(retry.at(-1), snapshot.at(-1))
		assertEquals(retry.at(-2), { role: 'system', content: OUTPUT_RECOVERY_PROMPT })
	} finally { mock.restore() }
})
