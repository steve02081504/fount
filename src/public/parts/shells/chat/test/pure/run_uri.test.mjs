/**
 * Chat runUri 深链测试。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	CHAT_RUN_PART,
	formatJoinRunUri,
	formatMessageRunUri,
	parseJoinRunUri,
	parseMessageRunUri,
} from '../../public/shared/runUri.mjs'

Deno.test('formatJoinRunUri uses shells:chat prefix', () => {
	const uri = formatJoinRunUri('gid', 'code')
	assert(uri.startsWith(`fount://run/${CHAT_RUN_PART}/join;`))
	assert(!uri.includes('parts:shells'))
})

Deno.test('parseJoinRunUri round-trips join payload', () => {
	const uri = formatJoinRunUri('gid', 'code', 'secret', 'a'.repeat(64))
	assertEquals(parseJoinRunUri(uri)?.groupId, 'gid')
	assertEquals(parseJoinRunUri(uri)?.roomSecret, 'secret')
})

Deno.test('formatMessageRunUri round-trips', () => {
	const uri = formatMessageRunUri('gid', 'ch', 'eid')
	assert(uri.startsWith(`fount://run/${CHAT_RUN_PART}/message;`))
	assertEquals(parseMessageRunUri(uri), { groupId: 'gid', channelId: 'ch', eventId: 'eid' })
})
