/**
 * Fallback 聚合源 BuildPrompt 委托。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { buildPromptInOrder } from '../../prompt.mjs'

/**
 * 构造一个仅实现 BuildPrompt 的假内层源。
 * @param {(prompt_struct: object) => Promise<object>} buildPrompt - 构建函数。
 * @returns {object} 假源。
 */
function fakeSource(buildPrompt) {
	return { BuildPrompt: buildPrompt }
}

/**
 * 吞掉测试中预期产生的错误日志。
 * @returns {void}
 */
function swallowError() { }

Deno.test('fallback BuildPrompt delegates to the first source exposing it', async () => {
	const prompt_struct = { marker: 1 }
	const inner = fakeSource(async ps => ({ from: 'inner', ps }))
	assertEquals(
		await buildPromptInOrder([{}, inner], prompt_struct),
		{ from: 'inner', ps: prompt_struct },
	)
})

Deno.test('fallback BuildPrompt returns empty object when no source exposes it', async () => {
	assertEquals(await buildPromptInOrder([{}, {}], {}), {})
})

Deno.test('fallback BuildPrompt skips throwing sources and continues in order', async () => {
	const originalError = console.error
	console.error = swallowError
	try {
		const bad = fakeSource(async () => { throw new Error('boom') })
		const good = fakeSource(async () => ({ ok: true }))
		assertEquals(await buildPromptInOrder([bad, good], {}), { ok: true })
	}
	finally {
		console.error = originalError
	}
})
