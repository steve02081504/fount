/**
 * Chat runUri 深链测试。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

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

Deno.test('parseJoinRunUri keeps introducerNodeHash when powAnchorRef omitted', () => {
	const pub = 'a'.repeat(64)
	const node = 'b'.repeat(64)
	const uri = formatJoinRunUri('gid', 'code', 'secret', pub, undefined, node)
	assert(uri.includes('introducerNodeHash='))
	assert(!uri.includes('powAnchorRef='))
	const parsed = parseJoinRunUri(uri)
	assertEquals(parsed?.introducerPubKeyHash, pub)
	assertEquals(parsed?.powAnchorRef, undefined)
	assertEquals(parsed?.introducerNodeHash, node)
})

Deno.test('parseJoinRunUri round-trips powAnchorRef and introducerNodeHash', () => {
	const pub = 'a'.repeat(64)
	const pow = 'c'.repeat(64)
	const node = 'b'.repeat(64)
	const uri = formatJoinRunUri('gid', 'code', 'secret', pub, pow, node)
	const parsed = parseJoinRunUri(uri)
	assertEquals(parsed?.roomSecret, 'secret')
	assertEquals(parsed?.powAnchorRef, pow)
	assertEquals(parsed?.introducerNodeHash, node)
})

Deno.test('parseJoinRunUri reads key=value fields regardless of order', () => {
	const pub = 'a'.repeat(64)
	const node = 'b'.repeat(64)
	const uri = `fount://run/${CHAT_RUN_PART}/join;gid;code;introducerNodeHash=${node};roomSecret=secret;introducerPubKeyHash=${pub}`
	const parsed = parseJoinRunUri(uri)
	assertEquals(parsed?.roomSecret, 'secret')
	assertEquals(parsed?.introducerPubKeyHash, pub)
	assertEquals(parsed?.introducerNodeHash, node)
})

Deno.test('formatMessageRunUri round-trips', () => {
	const uri = formatMessageRunUri('gid', 'ch', 'eid')
	assert(uri.startsWith(`fount://run/${CHAT_RUN_PART}/message;`))
	assertEquals(parseMessageRunUri(uri), { groupId: 'gid', channelId: 'ch', eventId: 'eid' })
})
