/**
 * remoteWorldProxy：METHOD_NOT_FOUND 降级为 undefined。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createRemoteWorldProxy } from '../../src/chat/federation/remoteWorldProxy.mjs'

Deno.test('remoteWorldProxy GetPrompt METHOD_NOT_FOUND returns undefined', async () => {
	const world = createRemoteWorldProxy('owner:world:test', 'node:abc', {}, async (_method, _args) => {
		const err = new Error('method not found: GetPrompt')
		err.code = 'METHOD_NOT_FOUND'
		throw err
	})
	const prompt = await world.interfaces.chat.GetPrompt?.({})
	assertEquals(prompt, undefined)
})
