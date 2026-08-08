/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { buildPromptStruct } from '../../src/prompt_struct/index.mjs'

/**
 * @returns {object} stub char part
 */
function stubChar() {
	return {
		interfaces: {
			chat: {
				/**
				 * @returns {Promise<object>} 空 prompt
				 */
				GetPrompt: async () => ({
					text: [{ content: 'char-only', description: '', important: 0 }],
					additional_chat_log: [],
					extension: {},
				}),
			},
		},
	}
}

Deno.test('buildPromptStruct tolerates null world and user', async () => {
	const prompt = await buildPromptStruct({
		char_id: 'char',
		Charname: 'Char',
		CharUid: 'char',
		UserCharname: 'User',
		UserUid: 'user',
		char: stubChar(),
		user: null,
		world: null,
		other_chars: {},
		other_personas: {},
		plugins: {},
		chat_log: [],
		timelines: [],
		locales: ['en-UK'],
		extension: {},
	})
	assertEquals(prompt.char_prompt.text[0].content, 'char-only')
	assertEquals(Array.isArray(prompt.world_prompt.text), true)
	assertEquals(Array.isArray(prompt.user_prompt.text), true)
})
