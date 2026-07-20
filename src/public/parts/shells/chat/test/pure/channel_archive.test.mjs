/* global Deno */
import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	CHANNEL_ARCHIVE_FORMAT,
	portableMessageFromSnapshot,
	reactionCountsFromList,
	validateChannelArchive,
} from '../../src/chat/channelArchiveFormat.mjs'
import {
	deriveMessageAttribution,
	isTrustedOwnerAttribution,
} from '../../src/chat/lib/attribution.mjs'

Deno.test('validateChannelArchive accepts portable shape', () => {
	const archive = validateChannelArchive({
		format: CHANNEL_ARCHIVE_FORMAT,
		exportedAt: '2026-01-01T00:00:00.000Z',
		source: { groupId: 'g', channelId: 'c', channelName: 'general' },
		messages: [],
	})
	assertEquals(archive.format, CHANNEL_ARCHIVE_FORMAT)
})

Deno.test('validateChannelArchive rejects wrong format/messages', () => {
	assertThrows(() => validateChannelArchive({ format: 'other', messages: [] }))
	assertThrows(() => validateChannelArchive({
		format: CHANNEL_ARCHIVE_FORMAT,
		messages: null,
	}))
})

Deno.test('reactionCountsFromList collapses voters to counts', () => {
	assertEquals(reactionCountsFromList([
		{ emoji: '👍', voters: [{ pubKeyHash: 'a' }, { pubKeyHash: 'b' }] },
		{ emoji: '🔥', voters: [{ pubKeyHash: 'c' }] },
		{ emoji: 'x', voters: [] },
	]), { '👍': 2, '🔥': 1 })
})

Deno.test('portableMessageFromSnapshot maps source identity fields', () => {
	const portable = portableMessageFromSnapshot({
		eventId: 'abc',
		timestamp: 1,
		hlc: { wall: 1, logical: 0 },
		charId: null,
		sender: 'aa'.repeat(32),
		sourceEntityHash: 'bb'.repeat(64),
		display: { name: 'Ada', avatar: null },
		content: { type: 'text', content: 'hi' },
		reactions: [{ emoji: '👍', voters: [{ pubKeyHash: 'x' }] }],
		pinned: true,
		deleted: false,
	})
	assertEquals(portable.sourceEventId, 'abc')
	assertEquals(portable.display.name, 'Ada')
	assertEquals(portable.sourceSenderPubKeyHash, 'aa'.repeat(32))
	assertEquals(portable.sourceEntityHash, 'bb'.repeat(64))
	assertEquals(portable.reactionCounts, { '👍': 1 })
	assertEquals(portable.pinned, true)
	assertEquals(portable.content.type, 'text')
})

Deno.test('deriveMessageAttribution marks importedFrom as mismatch', () => {
	const trusted = deriveMessageAttribution({ type: 'text', content: 'ok' }, { sender: 'aa'.repeat(32) })
	assertEquals(trusted.trusted, true)
	assertEquals(trusted.mismatch, false)

	const mismatch = deriveMessageAttribution({
		type: 'text',
		content: 'old',
		displayName: 'Ada',
		importedFrom: {
			groupId: 'g',
			channelId: 'c',
			eventId: 'e1',
			sourceEntityHash: 'cc'.repeat(64),
			signerEntityHash: 'dd'.repeat(64),
		},
	}, { sender: 'ee'.repeat(32) })
	assertEquals(mismatch.trusted, false)
	assertEquals(mismatch.mismatch, true)
	assertEquals(mismatch.reason, 'imported_resign')
	assertEquals(mismatch.claimedEntityHash, 'cc'.repeat(64))
})

Deno.test('isTrustedOwnerAttribution rejects mismatch even if hashes match', () => {
	const owner = 'aa'.repeat(64)
	assertEquals(isTrustedOwnerAttribution({
		trusted: true,
		mismatch: false,
		reason: null,
	}, owner, owner), true)
	assertEquals(isTrustedOwnerAttribution({
		trusted: false,
		mismatch: true,
		reason: 'imported_resign',
	}, owner, owner), false)
})
