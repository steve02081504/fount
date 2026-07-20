/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { buildPromptStruct, mergeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../src/prompt_struct/index.mjs'

/**
 * @param {object} [extra] 额外 chat 接口
 * @returns {object} stub part
 */
function stubPart(extra = {}) {
	return {
		interfaces: {
			chat: {
				/**
				 * @returns {Promise<object>} 空 prompt
				 */
				GetPrompt: async () => ({ text: [], additional_chat_log: [], extension: {} }),
				...extra,
			},
		},
	}
}

Deno.test('buildPromptStruct aggregates other_personas and fills activity meta', async () => {
	const prompt = await buildPromptStruct({
		char_id: 'char',
		Charname: 'Char',
		CharUid: 'char',
		UserCharname: 'User',
		UserUid: 'user',
		char: stubPart(),
		user: stubPart(),
		world: stubPart(),
		other_chars: {
			buddy: stubPart({
				/**
				 * @returns {Promise<object>} other char prompt
				 */
				GetPromptForOther: async () => ({
					text: [{ content: 'buddy-desc', description: '', important: 1 }],
					additional_chat_log: [],
					extension: {},
				}),
			}),
		},
		other_personas: {
			alice: stubPart({
				/**
				 * @returns {Promise<object>} other persona prompt
				 */
				GetPromptForOther: async () => ({
					text: [{ content: 'alice-persona', description: '', important: 1 }],
					additional_chat_log: [{
						name: 'alice',
						uid: 'alice',
						role: 'user',
						content: 'from-persona',
					}],
					extension: {},
				}),
			}),
		},
		plugins: {},
		chat_log: [],
		timelines: [],
		locales: ['zh-CN'],
		extension: {
			memberId: 'm1',
			channelActivity: {
				chars: { buddy: { last_active: 42, count: 3 } },
				personas: { alice: { last_active: 99, count: 2 } },
			},
		},
	})

	assertEquals(prompt.other_chars_prompts.buddy.is_active, true)
	assertEquals(prompt.other_chars_prompts.buddy.last_active, 42)
	assertEquals(prompt.other_personas_prompts.alice.is_active, true)
	assertEquals(prompt.other_personas_prompts.alice.last_active, 99)
	assertEquals(prompt.other_personas_prompts.alice.text[0].content, 'alice-persona')

	const flat = structPromptToSingleNoChatLog(prompt)
	assertEquals(flat.includes('Other persona settings:'), true)
	assertEquals(flat.includes('alice-persona'), true)

	const merged = mergeStructPromptChatLog(prompt)
	assertEquals(merged.some(row => row.content === 'from-persona'), true)
})
