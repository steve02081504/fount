/**
 * Chat runUri 深链测试。
 */
/* global Deno */
import { assert, assertEquals } from 'jsr:@std/assert'

import {
	CHAT_RUN_PART,
	formatJoinInviteUrl,
	formatJoinRunUri,
	formatMessageRunUri,
	parseJoinRunPayload,
	parseJoinRunUri,
	parseMessageRunUri,
} from '../../public/shared/runUri.mjs'

Deno.test('formatJoinRunUri uses shells:chat prefix and single JSON segment', () => {
	const uri = formatJoinRunUri({ groupId: 'gid', inviteCode: 'code' })
	assert(uri.startsWith(`fount://run/${CHAT_RUN_PART}/join;`))
	assert(!uri.includes('parts:shells'))
	const encoded = uri.slice(`fount://run/${CHAT_RUN_PART}/join;`.length)
	assertEquals(JSON.parse(decodeURIComponent(encoded)), { groupId: 'gid', inviteCode: 'code' })
})

Deno.test('parseJoinRunUri round-trips join payload', () => {
	const parsed = parseJoinRunUri(formatJoinRunUri({
		groupId: 'gid',
		inviteCode: 'code',
		roomSecret: 'secret',
		introducerPubKeyHash: 'a'.repeat(64),
	}))
	assertEquals(parsed, {
		groupId: 'gid',
		inviteCode: 'code',
		roomSecret: 'secret',
		introducerPubKeyHash: 'a'.repeat(64),
	})
})

Deno.test('parseJoinRunUri keeps introducerNodeHash when powAnchorRef omitted', () => {
	const introducerPubKeyHash = 'a'.repeat(64)
	const introducerNodeHash = 'b'.repeat(64)
	const parsed = parseJoinRunUri(formatJoinRunUri({
		groupId: 'gid',
		inviteCode: 'code',
		roomSecret: 'secret',
		introducerPubKeyHash,
		introducerNodeHash,
	}))
	assertEquals(parsed, {
		groupId: 'gid',
		inviteCode: 'code',
		roomSecret: 'secret',
		introducerPubKeyHash,
		introducerNodeHash,
	})
})

Deno.test('parseJoinRunUri round-trips powAnchorRef and introducerNodeHash', () => {
	const introducerPubKeyHash = 'a'.repeat(64)
	const powAnchorRef = 'c'.repeat(64)
	const introducerNodeHash = 'b'.repeat(64)
	const parsed = parseJoinRunUri(formatJoinRunUri({
		groupId: 'gid',
		inviteCode: 'code',
		roomSecret: 'secret',
		introducerPubKeyHash,
		powAnchorRef,
		introducerNodeHash,
	}))
	assertEquals(parsed, {
		groupId: 'gid',
		inviteCode: 'code',
		roomSecret: 'secret',
		introducerPubKeyHash,
		powAnchorRef,
		introducerNodeHash,
	})
})

Deno.test('parseJoinRunPayload accepts IPC decoded JSON segment', () => {
	const payload = {
		groupId: '8hp81fj3k2n',
		inviteCode: 'code',
		roomSecret: '73095b69-862a-4611-9caf-3f972818f9ba',
		introducerPubKeyHash: 'a'.repeat(64),
		powAnchorRef: 'c'.repeat(64),
		introducerNodeHash: 'b'.repeat(64),
	}
	// protocolhandler：split(';').map(decodeURIComponent) → invocationArguments = ['join', jsonString]
	const invocationArguments = ['join', JSON.stringify(payload)]
	assertEquals(parseJoinRunPayload(invocationArguments[1]), payload)
})

Deno.test('formatJoinInviteUrl omits powAnchorRef regardless of joinPolicy', () => {
	for (const joinPolicy of ['invite-only', 'open', 'pow']) {
		const url = formatJoinInviteUrl({
			groupId: 'gid',
			inviteCode: 'code',
			roomSecret: 'secret',
			introducerPubKeyHash: 'a'.repeat(64),
			introducerNodeHash: 'b'.repeat(64),
		})
		assert(url.startsWith('https://steve02081504.github.io/fount/protocol?url='))
		const runUri = decodeURIComponent(url.slice('https://steve02081504.github.io/fount/protocol?url='.length))
		const parsed = parseJoinRunUri(runUri)
		assertEquals(parsed.powAnchorRef, undefined, `no powAnchorRef for ${joinPolicy}`)
		assertEquals(parsed.introducerNodeHash, 'b'.repeat(64))
	}
})

Deno.test('formatJoinInviteUrl ignores state param (anchor no longer in URL)', () => {
	const url = formatJoinInviteUrl({
		groupId: 'gid',
		inviteCode: 'code',
		roomSecret: 'secret',
		introducerPubKeyHash: 'a'.repeat(64),
		introducerNodeHash: 'b'.repeat(64),
	})
	const runUri = decodeURIComponent(url.slice('https://steve02081504.github.io/fount/protocol?url='.length))
	const parsed = parseJoinRunUri(runUri)
	assertEquals(parsed.powAnchorRef, undefined)
})

Deno.test('parseJoinRunUri rejects non-JSON legacy join segments', () => {
	assertEquals(parseJoinRunUri(`fount://run/${CHAT_RUN_PART}/join;gid;code;roomSecret=secret`), null)
})

Deno.test('parseJoinRunUri requires exactly one payload segment', () => {
	assertEquals(parseJoinRunUri(`fount://run/${CHAT_RUN_PART}/join`), null)
	const payload = encodeURIComponent(JSON.stringify({ groupId: 'gid', inviteCode: 'code' }))
	assertEquals(parseJoinRunUri(`fount://run/${CHAT_RUN_PART}/join;${payload};extra`), null)
})

Deno.test('formatMessageRunUri round-trips', () => {
	const uri = formatMessageRunUri('gid', 'ch', 'eid')
	assert(uri.startsWith(`fount://run/${CHAT_RUN_PART}/message;`))
	assertEquals(parseMessageRunUri(uri), { groupId: 'gid', channelId: 'ch', eventId: 'eid' })
})
