/* global Deno */
import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	CHANNEL_ARCHIVE_FORMAT,
	CHANNEL_ARCHIVE_VERSION,
	portableMessageFromSnapshot,
	reactionCountsFromList,
	validateChannelArchive,
} from '../../src/chat/channelArchiveFormat.mjs'

Deno.test('validateChannelArchive accepts v1 portable shape', () => {
	const archive = validateChannelArchive({
		format: CHANNEL_ARCHIVE_FORMAT,
		version: CHANNEL_ARCHIVE_VERSION,
		exportedAt: '2026-01-01T00:00:00.000Z',
		source: { groupId: 'g', channelId: 'c', channelName: 'general' },
		messages: [],
	})
	assertEquals(archive.format, CHANNEL_ARCHIVE_FORMAT)
})

Deno.test('validateChannelArchive rejects wrong format/version', () => {
	assertThrows(() => validateChannelArchive({ format: 'other', version: 1, messages: [] }))
	assertThrows(() => validateChannelArchive({
		format: CHANNEL_ARCHIVE_FORMAT,
		version: 99,
		messages: [],
	}))
	assertThrows(() => validateChannelArchive({
		format: CHANNEL_ARCHIVE_FORMAT,
		version: 1,
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

Deno.test('portableMessageFromSnapshot maps final view fields', () => {
	const portable = portableMessageFromSnapshot({
		eventId: 'abc',
		timestamp: 1,
		hlc: { wall: 1, logical: 0 },
		charId: null,
		display: { name: 'Ada', avatar: null },
		content: { type: 'text', content: 'hi' },
		reactions: [{ emoji: '👍', voters: [{ pubKeyHash: 'x' }] }],
		pinned: true,
		deleted: false,
	})
	assertEquals(portable.sourceEventId, 'abc')
	assertEquals(portable.display.name, 'Ada')
	assertEquals(portable.reactionCounts, { '👍': 1 })
	assertEquals(portable.pinned, true)
	assertEquals(portable.content.type, 'text')
})
