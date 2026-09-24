/**
 * local `BuildPrompt`（经 `buildLocalPromptStruct`）：出站 `{ messages }` 形态；
 * 图片不发送，仅以占位说明，故无二进制字节。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import { buildLocalPromptStruct } from '../../src/promptBuilder.mjs'

/** 最小 PNG 头（仅用于确认图片字节不会进入出站结构）。 */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * 递归判断结构中是否残留二进制。
 * @param {unknown} value 待检查值
 * @returns {boolean} 是否含 Uint8Array/Buffer
 */
function containsBinary(value) {
	if (value instanceof Uint8Array) return true
	if (Array.isArray(value)) return value.some(containsBinary)
	if (value && typeof value === 'object') return Object.values(value).some(containsBinary)
	return false
}

Deno.test('local BuildPrompt returns { messages } and omits image bytes', () => {
	const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })
	const entry = conversation.addUser('看看这张图', 'user-1')
	entry.files = [{ name: 'a.png', mime_type: 'image/png', buffer: PNG }]

	const out = buildLocalPromptStruct(conversation.makePromptStruct(), {})

	assert(Array.isArray(out.messages), 'messages array expected')
	assertEquals(out.messages.map(message => message.role), ['system', 'user'])
	assert(out.messages[1].content.includes('[local GGUF: image input omitted]'), 'image omission notice expected')
	assertEquals(containsBinary(out), false, 'no raw image bytes in outbound structure')
})
