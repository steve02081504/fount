/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { buildPromptStruct } from '../../src/prompt_struct/index.mjs'

Deno.test('buildPromptStruct injects attribution mismatch warnings', async () => {
	/**
	 *
	 */
	const stubPart = {
		interfaces: {
			chat: {
				/**
				 * @returns {Promise<object>} 空 prompt
				 */
				GetPrompt: async () => ({ text: [], additional_chat_log: [], extension: {} }),
			},
		},
	}
	const prompt = await buildPromptStruct({
		char_id: 'char',
		Charname: 'Char',
		UserCharname: 'User',
		char: stubPart,
		user: stubPart,
		world: stubPart,
		other_chars: {},
		plugins: {},
		chat_log: [{
			id: '1',
			name: 'Ada',
			role: 'user',
			content: 'hi',
			extension: {
				attribution: {
					trusted: false,
					mismatch: true,
					reason: 'imported_resign',
				},
				display: { name: 'Ada' },
			},
		}],
		timelines: [],
		locales: ['zh-CN'],
		extension: { memberId: 'm1' },
	})
	const warnings = prompt.world_prompt.additional_chat_log || []
	assertEquals(warnings.length >= 1, true)
	assertEquals(warnings.some(row => String(row.content).includes('身份归因警告')), true)
	assertEquals(prompt.extension.attributionWarnings?.length, 1)
})
