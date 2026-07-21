/**
 * wechatbot format 纯测试。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { splitWechatText } from '../../src/format.mjs'

Deno.test('splitWechatText respects UTF-8 byte limit', () => {
	const text = '测'.repeat(700)
	const parts = splitWechatText(text, 2048)
	assert(parts.length >= 2)
	for (const part of parts)
		assert(new TextEncoder().encode(part).length <= 2048)
})

Deno.test('splitWechatText keeps short text intact', () => {
	const parts = splitWechatText('hello')
	assertEquals(parts, ['hello'])
})
