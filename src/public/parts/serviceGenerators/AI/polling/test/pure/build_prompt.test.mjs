/**
 * Polling 聚合源轮询选择与 BuildPrompt 委托。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { advancePollingIndex, buildPromptPolling, nextPollingSource, pickPollingSource } from '../../prompt.mjs'

/**
 * 构造一个仅实现 BuildPrompt 的假内层源。
 * @param {(prompt_struct: object) => Promise<object>} buildPrompt - 构建函数。
 * @returns {object} 假源。
 */
function fakeSource(buildPrompt) {
	return { BuildPrompt: buildPrompt }
}

Deno.test('advancePollingIndex wraps around', () => {
	assertEquals(advancePollingIndex(-1, 2), 0)
	assertEquals(advancePollingIndex(0, 2), 1)
	assertEquals(advancePollingIndex(1, 2), 0)
})

Deno.test('pickPollingSource returns undefined for an empty list', () => {
	assertEquals(pickPollingSource([], 0), undefined)
})

Deno.test('nextPollingSource selects the prospective rotation target', () => {
	const a = { name: 'a' }
	const b = { name: 'b' }
	assertEquals(nextPollingSource([a, b], -1), a)
	assertEquals(nextPollingSource([a, b], 0), b)
})

Deno.test('polling BuildPrompt delegates to the rotation target', async () => {
	const prompt_struct = { marker: 5 }
	const a = fakeSource(async () => ({ from: 'a' }))
	const b = fakeSource(async ps => ({ from: 'b', ps }))
	assertEquals(await buildPromptPolling([a, b], -1, prompt_struct), { from: 'a' })
	assertEquals(await buildPromptPolling([a, b], 0, prompt_struct), { from: 'b', ps: prompt_struct })
})

Deno.test('polling BuildPrompt returns empty object when no source exposes it', async () => {
	assertEquals(await buildPromptPolling([{}, {}], -1, {}), {})
})
