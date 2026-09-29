/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { messageReducers } from '../../src/chat/dag/reducers/messages.mjs'

/**
 * 最小 reducer 状态。
 * @returns {object} 初始状态
 */
function emptyState() {
	return {
		channels: {},
		messageSenderIndex: {},
		messageOverlay: {
			pins: new Map(),
			reactions: new Map(),
			votes: new Map(),
			deletedIds: new Set(),
			editHistory: new Map(),
			feedbackHistory: new Map(),
		},
	}
}

const EVENT_ID = 'a'.repeat(64)

Deno.test('message reducer never fabricates a default channel when channelId is absent', () => {
	const state = messageReducers.message(emptyState(), {
		type: 'message',
		id: EVENT_ID,
		sender: 'sender-hash',
		content: { type: 'text' },
	})
	assertEquals(state.channels.default, undefined)
	assertEquals(state.messageSenderIndex[EVENT_ID].channelId, null)
})

Deno.test('message reducer tracks the real channel id', () => {
	const state = emptyState()
	state.channels.room1 = { messageSeq: 0, lastEventId: null }
	messageReducers.message(state, {
		type: 'message',
		id: EVENT_ID,
		sender: 'sender-hash',
		channelId: 'room1',
		content: { type: 'text' },
	})
	assertEquals(state.channels.room1.messageSeq, 1)
	assertEquals(state.channels.room1.lastEventId, EVENT_ID)
	assertEquals(state.messageSenderIndex[EVENT_ID].channelId, 'room1')
})

Deno.test('message reducer stores ballot channelId as the event channel (null when absent)', () => {
	const withoutChannel = messageReducers.message(emptyState(), {
		type: 'message',
		id: EVENT_ID,
		sender: 'sender-hash',
		content: { type: 'vote', question: 'q', options: ['a'] },
	})
	assertEquals(withoutChannel.voteBallots[EVENT_ID].channelId, null)

	const withChannel = messageReducers.message(emptyState(), {
		type: 'message',
		id: EVENT_ID,
		sender: 'sender-hash',
		channelId: 'room1',
		content: { type: 'vote', question: 'q', options: ['a'] },
	})
	assertEquals(withChannel.voteBallots[EVENT_ID].channelId, 'room1')
})
