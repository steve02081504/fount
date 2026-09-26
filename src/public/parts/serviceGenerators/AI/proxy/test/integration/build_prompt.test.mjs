/* global Deno */
/**
 * proxy `BuildPrompt`：出站 OpenAI 兼容 messages 形态（含 `system_prompt_at_depth`），附件二进制保留为 Buffer，
 * 且经 `serializeSnapshotValue` 序列化后走变长 buffer hash（不出现 base64）。
 */
import { Buffer } from 'node:buffer'

import { assert, assertEquals } from 'jsr:@std/assert'

import { serializeSnapshotValue } from 'fount/public/parts/shells/chat/src/prompt_struct/serializeSnapshot.mjs'
import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import generator from '../../main.mjs'

/**
 * 构造带默认 convert_config 的 proxy 源。
 * @param {object} [overrides] - 覆盖配置。
 * @returns {Promise<object>} AI 源
 */
async function makeSource(overrides = {}) {
	return generator.interfaces.serviceGenerator.GetSource({
		name: 'proxy-build-prompt',
		url: 'https://example.invalid/v1/chat/completions',
		model: 'mock-model',
		apikey: 'test-key',
		context_size: 128000,
		system_prompt_at_depth: 0,
		use_stream: false,
		model_arguments: { temperature: 0, n: 1, logprobs: false },
		convert_config: {
			roleReminding: false,
			ignoreFiles: [],
			forbidSystemFiles: [],
			forbidAssistantFiles: [],
			forceRoleAlternation: false,
			forceUserMessageEnding: false,
			forceNoSystemMessages: false,
		},
		...overrides,
	}, {
		/**
		 * 忽略配置持久化的桩函数。
		 * @returns {void}
		 */
		SaveConfig: () => { }
	})
}

Deno.test('proxy BuildPrompt keeps attachment bytes as Buffer', async () => {
	const source = await makeSource()
	const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })
	conversation.addUser('看图')
	conversation.addChar('好')
	const prompt = conversation.makePromptStruct()
	prompt.chat_log.find(entry => entry.role === 'user').files = [
		{ name: 'a.png', mime_type: 'image/png', buffer: Buffer.from([1, 2, 3, 4, 5]) },
	]

	const built = await source.BuildPrompt(prompt)
	assert(Array.isArray(built), 'proxy BuildPrompt returns a messages array')
	assertEquals(built[0].role, 'system', 'system prompt stays first at depth 0')

	const imagePart = built
		.flatMap(message => Array.isArray(message.content) ? message.content : [])
		.find(part => part.type === 'image_url')
	assert(imagePart, 'image content part expected')
	assert(imagePart.image_url.data instanceof Uint8Array, 'attachment bytes must stay a Buffer')
	assertEquals('url' in imagePart.image_url, false, 'no base64 data URL in the normalized structure')
})

Deno.test('proxy BuildPrompt serializes to a snapshot with a hashed buffer', async () => {
	const source = await makeSource()
	const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })
	conversation.addUser('看图')
	const prompt = conversation.makePromptStruct()
	prompt.chat_log.find(entry => entry.role === 'user').files = [
		{ name: 'a.png', mime_type: 'image/png', buffer: Buffer.from([1, 2, 3, 4, 5]) },
	]

	const snapshot = serializeSnapshotValue(await source.BuildPrompt(prompt))
	assert(snapshot.includes('<buffer 5B'), 'buffer must be reduced to a hash marker')
	assert(!snapshot.includes('base64'), 'snapshot must not embed base64')
})

Deno.test('proxy BuildPrompt keeps chat image_url but maps Responses input to input_image', async () => {
	const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })
	conversation.addUser('看图')
	conversation.makePromptStruct().chat_log.find(entry => entry.role === 'user').files = [
		{ name: 'a.png', mime_type: 'image/png', buffer: Buffer.from([1, 2, 3, 4, 5]) },
	]

	const chatSource = await makeSource()
	const chatBody = await chatSource.BuildPrompt(conversation.makePromptStruct())
	assert(Array.isArray(chatBody), 'chat style keeps the messages array')
	const chatImage = chatBody.flatMap(message => Array.isArray(message.content) ? message.content : [])
		.find(part => part.type === 'image_url')
	assert(chatImage, 'chat style must keep image_url for older Chat Completions APIs')

	const responsesSource = await makeSource({
		url: 'https://example.invalid/v1/responses',
		api_mode: 'responses',
	})
	const responsesBody = await responsesSource.BuildPrompt(conversation.makePromptStruct())
	const responsesImage = responsesBody.input.flatMap(item => Array.isArray(item.content) ? item.content : [])
		.find(part => part.type === 'input_image')
	assert(responsesImage, 'Responses style must map images to input_image')
})

Deno.test('proxy BuildPrompt appends the assistant prefill envelope by default', async () => {
	const source = await makeSource()
	const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })
	conversation.addUser('你好')

	const built = await source.BuildPrompt(conversation.makePromptStruct())
	const last = built[built.length - 1]
	assertEquals(last.role, 'assistant')
	assert(last.content.includes('<sender>ZL-31</sender>'), 'prefill must carry the char name')
	assert(last.content.includes('<content>'), 'prefill must open the content envelope')
})

Deno.test('proxy BuildPrompt skips roleReminding when prefill carries the continue cue', async () => {
	const source = await makeSource()
	const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })
	conversation.addUser('你好')
	conversation.chat_log.push({ name: 'Bob', uid: 'user', role: 'user', content: 'hi' })
	conversation.chat_log.push({ name: 'Carol', uid: 'user', role: 'user', content: 'hello' })

	const built = await source.BuildPrompt(conversation.makePromptStruct())
	assertEquals(built.some(message => typeof message.content === 'string' && message.content.includes('续写对话')), false)
	assertEquals(built[built.length - 1].role, 'assistant')
})

Deno.test('proxy BuildPrompt keeps roleReminding when assistantPrefill is disabled', async () => {
	const source = await makeSource({ convert_config: { assistantPrefill: false, roleReminding: true } })
	const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })
	conversation.addUser('你好')
	conversation.chat_log.push({ name: 'Bob', uid: 'user', role: 'user', content: 'hi' })
	conversation.chat_log.push({ name: 'Carol', uid: 'user', role: 'user', content: 'hello' })

	const built = await source.BuildPrompt(conversation.makePromptStruct())
	const reminding = built.find(message => typeof message.content === 'string' && message.content.includes('续写对话'))
	assert(reminding, 'roleReminding system message expected when prefill is off')
	assertEquals(built[built.length - 1].role, 'system')
})
