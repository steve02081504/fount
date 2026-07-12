/**
 * M6：discordbot format 纯测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	rewriteDiscordMentionsToFount,
	splitDiscordReply,
} from '../../src/format.mjs'

Deno.test('splitDiscordReply splits long text', () => {
	const parts = splitDiscordReply('a'.repeat(5000), 2000)
	assertEquals(parts.length, 3)
	assertEquals(parts.join('').length, 5000)
})

Deno.test('rewriteDiscordMentionsToFount role mention becomes everyone', async () => {
	const username = `dc-fmt-${crypto.randomUUID().slice(0, 8)}`
	const out = await rewriteDiscordMentionsToFount(username, 'ping <@&12345> and @here')
	assertEquals(out, 'ping @[everyone] and @[here]')
})
