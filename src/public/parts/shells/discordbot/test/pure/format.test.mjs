/**
 * M6：discordbot format 纯测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	formatDiscordPoll,
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
	assertEquals(out, 'ping @[role:everyone] and @[role:here]')
})

Deno.test('formatDiscordPoll renders question, answers, deadline and multiselect', () => {
	const expiresTimestamp = Date.UTC(2026, 0, 2, 3, 4, 5)
	const text = formatDiscordPoll({
		question: { text: '午饭吃什么' },
		answers: new Map([
			[1, { text: '拉面', votes: 3 }],
			[2, { text: '寿司', votes: 0 }],
		]),
		expiresTimestamp,
		allowMultiselect: true,
	})
	assertEquals(text, [
		'[投票] 午饭吃什么',
		'- 拉面 (3)',
		'- 寿司 (0)',
		`截止: ${new Date(expiresTimestamp).toISOString()}`,
		'(多选)',
	].join('\n'))
})
