/**
 * Empty 源 BuildPrompt 始终返回空对象。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import generator from '../../main.mjs'

Deno.test('empty BuildPrompt returns an empty object', async () => {
	const source = await generator.interfaces.serviceGenerator.GetSource({})
	assertEquals(await source.BuildPrompt({}), {})
})
