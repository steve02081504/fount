/* global Deno */
import { mentionsEntity } from 'fount/public/parts/shells/chat/public/shared/mentions.mjs'
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	chatInboxCursor,
	deriveChatInboxMentionRow,
} from '../../src/chat/lib/inbox.mjs'

const VIEWER = 'a'.repeat(128)
const OTHER = 'b'.repeat(128)

Deno.test('mentionsEntity direct hash hit', () => {
	assert(mentionsEntity({ entityHashes: [VIEWER] }, VIEWER))
	assert(!mentionsEntity({ entityHashes: [OTHER] }, VIEWER))
})

Deno.test('deriveChatInboxMentionRow matches viewer and skips self mention', () => {
	const senderKey = 'c'.repeat(64)
	const state = { members: {} }
	const row = deriveChatInboxMentionRow(VIEWER, 'g1', 'default', {
		type: 'message',
		eventId: 'f'.repeat(64),
		sender: senderKey,
		content: { type: 'text', content: `@${VIEWER} ping` },
		hlc: { wall: 1000 },
	}, state)
	assert(row)
	assertEquals(row.kind, 'mention')
	assertEquals(row.groupId, 'g1')
	assertEquals(row.at, 1000)

	const selfRow = deriveChatInboxMentionRow(VIEWER, 'g1', 'default', {
		type: 'message',
		eventId: 'e'.repeat(64),
		sender: VIEWER,
		content: { type: 'text', content: `@${VIEWER} ping` },
		hlc: { wall: 1000 },
	}, {
		members: {
			[VIEWER]: {
				status: 'active',
				memberKind: 'agent',
				entityHash: VIEWER,
				charname: 'self-agent',
			},
		},
	})
	assertEquals(selfRow, null)
})

Deno.test('chatInboxCursor stable for pagination', () => {
	const cursor = chatInboxCursor({ at: 1, groupId: 'g', eventId: 'e' })
	assertEquals(cursor, '1:g:e')
})
