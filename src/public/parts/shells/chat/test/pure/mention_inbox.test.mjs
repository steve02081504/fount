/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { extractMentionEntityHashes } from 'fount/public/pages/scripts/lib/mentions.mjs'
import {
	deriveMentionInboxRow,
	mentionInboxCursor,
} from '../../src/chat/lib/mentionInbox.mjs'

const VIEWER = 'a'.repeat(128)
const OTHER = 'b'.repeat(128)

Deno.test('extractMentionEntityHashes shared parser finds 128-hex', () => {
	const text = `hello @${VIEWER} and @${OTHER}`
	const found = extractMentionEntityHashes(text)
	assertEquals(found.length, 2)
	assert(found.includes(VIEWER))
})

Deno.test('deriveMentionInboxRow matches viewer and skips self mention', () => {
	const senderKey = 'c'.repeat(64)
	const state = { members: {} }
	const row = deriveMentionInboxRow(VIEWER, 'g1', 'default', {
		type: 'message',
		eventId: 'f'.repeat(64),
		sender: senderKey,
		content: { type: 'text', content: `@${VIEWER} ping` },
		hlc: { wall: 1000 },
	}, state)
	assert(row)
	assertEquals(row.groupId, 'g1')
	assertEquals(row.channelId, 'default')
	assertEquals(row.at, 1000)

	const selfRow = deriveMentionInboxRow(VIEWER, 'g1', 'default', {
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
				agentEntityHash: VIEWER,
				charname: 'self-agent',
			},
		},
	})
	assertEquals(selfRow, null)
})

Deno.test('mentionInboxCursor stable for pagination', () => {
	const cursor = mentionInboxCursor({ at: 1, groupId: 'g', eventId: 'e' })
	assertEquals(cursor, '1:g:e')
})
