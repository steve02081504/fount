/**
 * Multi-Compare 聚合源 BuildPrompt 委托。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { buildPromptFromFirstSource } from '../../prompt.mjs'

/**
 * 构造一个仅实现 BuildPrompt 的假内层源。
 * @param {(prompt_struct: object) => Promise<object>} buildPrompt - 构建函数。
 * @returns {object} 假源。
 */
function fakeSource(buildPrompt) {
	return { BuildPrompt: buildPrompt }
}

Deno.test('multi-compare BuildPrompt delegates to the first source', async () => {
	const prompt_struct = { marker: 7 }
	const first = fakeSource(async ps => ({ from: 'first', ps }))
	const second = fakeSource(async () => ({ from: 'second' }))
	assertEquals(
		await buildPromptFromFirstSource([first, second], prompt_struct),
		{ from: 'first', ps: prompt_struct },
	)
})

Deno.test('multi-compare BuildPrompt returns empty object when no source exists', async () => {
	assertEquals(await buildPromptFromFirstSource([], {}), {})
})

Deno.test('multi-compare BuildPrompt returns empty object when first source lacks it', async () => {
	assertEquals(await buildPromptFromFirstSource([{}, fakeSource(async () => ({}))], {}), {})
})
