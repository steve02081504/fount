/**
 * 缺陷B 回归：reaction_add / reaction_remove 是可折叠过程事件，fold 后即从 events.jsonl 删除，
 * 状态仅留存于物化 overlay（messageOverlay.reactions）。读路径 aggregateReactionsForMessages
 * 必须以物化 state（真相源）为准，从 overlay 聚合——无论是否已 fold、单节点还是联邦 B
 * 节点 ingest 后都能正确读到，且取消反应（reaction_remove）后该投票者不再出现。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { messageReducers } from '../../src/chat/dag/reducers/messages.mjs'
import { aggregateReactionsForMessages } from '../../src/group/queries.mjs'

const VOTER_A = 'a'.repeat(64)
const VOTER_B = 'b'.repeat(64)
const messageEventId = 'd'.repeat(64)
const CHANNEL = 'channel_x'

/**
 * 构造最小物化状态。
 * @returns {object} 含 message 索引与空 reactions overlay 的最小物化状态
 */
function freshState() {
	return {
		groupId: 'g',
		messageSenderIndex: { [messageEventId]: { sender: VOTER_A, charOwner: null, charId: null, channelId: CHANNEL } },
		messageOverlay: { reactions: new Map() },
	}
}

/**
 * 应用一条 reaction 事件到物化状态。
 * @param {object} state 物化状态
 * @param {string} type reaction_add / reaction_remove
 * @param {string} sender 投票者
 * @param {object} [extra] 额外 content
 * @returns {void}
 */
function applyReaction(state, type, sender, extra = {}) {
	messageReducers[type](state, {
		type,
		sender,
		channelId: CHANNEL,
		content: { targetId: messageEventId, emoji: '👍', ...extra },
	})
}

Deno.test('aggregate reads reactions from overlay after fold (events.jsonl gone)', () => {
	const state = freshState()
	applyReaction(state, 'reaction_add', VOTER_A)
	applyReaction(state, 'reaction_add', VOTER_B)

	const reactions = aggregateReactionsForMessages(state, CHANNEL, [messageEventId])
	const row = reactions[messageEventId]?.['👍']
	assertEquals(row?.voters?.length, 2)
	assertEquals(new Set(row.voters), new Set([VOTER_A, VOTER_B]))
})

Deno.test('aggregate reflects reaction_remove (cancelled voter dropped)', () => {
	const state = freshState()
	applyReaction(state, 'reaction_add', VOTER_A)
	applyReaction(state, 'reaction_add', VOTER_B)
	applyReaction(state, 'reaction_remove', VOTER_B, { targetPubKeyHash: VOTER_B })

	const reactions = aggregateReactionsForMessages(state, CHANNEL, [messageEventId])
	assertEquals(reactions[messageEventId]?.['👍']?.voters, [VOTER_A])
})

Deno.test('aggregate drops emoji key entirely when all voters removed', () => {
	const state = freshState()
	applyReaction(state, 'reaction_add', VOTER_A)
	applyReaction(state, 'reaction_remove', VOTER_A, { targetPubKeyHash: VOTER_A })
	assertEquals(aggregateReactionsForMessages(state, CHANNEL, [messageEventId]), {})
})

Deno.test('aggregate scopes reactions to the target message channel', () => {
	const state = freshState()
	applyReaction(state, 'reaction_add', VOTER_A)
	assertEquals(aggregateReactionsForMessages(state, 'channel_other', [messageEventId]), {})
	assertEquals(aggregateReactionsForMessages(state, CHANNEL, [messageEventId])[messageEventId]?.['👍']?.voters, [VOTER_A])
})

Deno.test('aggregate only includes requested message eventIds', () => {
	const state = freshState()
	applyReaction(state, 'reaction_add', VOTER_A)
	const otherId = 'e'.repeat(64)
	state.messageSenderIndex[otherId] = { sender: VOTER_A, channelId: CHANNEL }
	state.messageOverlay.reactions.set(`${otherId}:👍`, new Set([VOTER_B]))
	assertEquals(Object.keys(aggregateReactionsForMessages(state, CHANNEL, [messageEventId])), [messageEventId])
})

Deno.test('aggregate handles multi-codepoint emoji containing colons', () => {
	const state = freshState()
	messageReducers.reaction_add(state, {
		type: 'reaction_add',
		sender: VOTER_A,
		channelId: CHANNEL,
		content: { targetId: messageEventId, emoji: ':custom:emoji:' },
	})
	const reactions = aggregateReactionsForMessages(state, CHANNEL, [messageEventId])
	assertEquals(reactions[messageEventId]?.[':custom:emoji:']?.voters, [VOTER_A])
})
