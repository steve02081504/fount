/**
 * If-Else 聚合源条件选择与 BuildPrompt 委托。
 */
/* global Deno */
import { assertEquals, assertRejects } from 'jsr:@std/assert'

import { buildPromptByCondition, createConditionSelector, promptStructContent } from '../../prompt.mjs'

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

Deno.test('createConditionSelector returns the source of the first matching if rule', async () => {
	const target = 'source A'
	const source = fakeSource(async () => ({}))
	const selector = createConditionSelector({
		ifRules: [
			{ type: 'if', condition: 'false', target: 'source B' },
			{ type: 'if', condition: 'true', target },
		],
		sourceMap: new Map([[JSON.stringify(target), source]]),
	})
	assertEquals(await selector('', null), source)
})

Deno.test('createConditionSelector throws when no rule matches', async () => {
	const selector = createConditionSelector({
		ifRules: [{ type: 'if', condition: 'false', target: 'x' }],
		sourceMap: new Map(),
	})
	await assertRejects(() => selector('', null), Error, 'no matching condition found')
})

Deno.test('ifelse BuildPrompt delegates to the condition-selected source', async () => {
	const prompt_struct = { marker: 3 }
	const source = fakeSource(async ps => ({ from: 'condition', ps }))
	assertEquals(
		await buildPromptByCondition('content', prompt_struct, async () => source),
		{ from: 'condition', ps: prompt_struct },
	)
})

Deno.test('ifelse BuildPrompt returns empty object when no source is selected', async () => {
	const originalError = console.error
	console.error = swallowError
	try {
		assertEquals(
			await buildPromptByCondition('content', {}, async () => { throw new Error('no matching condition found') }),
			{},
		)
	}
	finally {
		console.error = originalError
	}
})

Deno.test('promptStructContent joins non-empty chat_log contents', () => {
	assertEquals(
		promptStructContent({ chat_log: [{ content: 'a' }, { content: '' }, { content: 'b' }] }),
		'a\nb',
	)
})
