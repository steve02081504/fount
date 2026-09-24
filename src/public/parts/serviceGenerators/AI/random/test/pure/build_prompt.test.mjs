/**
 * Random 聚合源加权选择与 BuildPrompt 委托。
 */
/* global Deno */
import { assertEquals, assertStrictEquals } from 'jsr:@std/assert'

import { buildPromptByWeight, selectSourceByWeight } from '../../prompt.mjs'

/**
 * 构造一个仅实现 BuildPrompt 的假内层源。
 * @param {(prompt_struct: object) => Promise<object>} buildPrompt - 构建函数。
 * @returns {object} 假源。
 */
function fakeSource(buildPrompt) {
	return { BuildPrompt: buildPrompt }
}

Deno.test('selectSourceByWeight returns the only source', () => {
	const source = fakeSource(async () => ({}))
	assertStrictEquals(selectSourceByWeight([{ weight: 1, source }]), source)
})

Deno.test('random BuildPrompt delegates to the weighted source', async () => {
	const prompt_struct = { marker: 2 }
	const source = fakeSource(async ps => ({ from: 'weighted', ps }))
	assertEquals(
		await buildPromptByWeight([{ weight: 5, source }], prompt_struct),
		{ from: 'weighted', ps: prompt_struct },
	)
})

Deno.test('random BuildPrompt returns empty object when the source lacks BuildPrompt', async () => {
	assertEquals(await buildPromptByWeight([{ weight: 1, source: {} }], {}), {})
})
