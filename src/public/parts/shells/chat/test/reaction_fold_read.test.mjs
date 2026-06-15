/**
 * 缺陷B 回归：reaction_add / reaction_remove 是可折叠过程事件，fold 后即从 events.jsonl 删除，
 * 状态仅留存于物化 overlay（messageOverlay.reactions）。读路径 synthesizeChannelReactionEvents
 * 必须以物化 state（真相源）为准，从 overlay 合成 reaction 行——无论是否已 fold、单节点还是联邦 B
 * 节点 ingest 后都能正确读到，且取消反应（reaction_remove）后该投票者不再出现。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { messageReducers } from '../../../../../scripts/p2p/reducers/chat/messages.mjs'
import { synthesizeChannelReactionEvents } from '../src/group/queries.mjs'

const VOTER_A = 'a'.repeat(64)
const VOTER_B = 'b'.repeat(64)
const MSG = 'd'.repeat(64)
const CHANNEL = 'channel_x'

/**
 * @returns {object} 含 message 索引与空 reactions overlay 的最小物化状态
 */
function freshState() {
	return {
		groupId: 'g',
		messageSenderIndex: { [MSG]: { sender: VOTER_A, charOwner: null, charId: null, channelId: CHANNEL } },
		messageOverlay: { reactions: new Map() },
	}
}

/**
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
		content: { targetId: MSG, emoji: '👍', ...extra },
	})
}

Deno.test('synthesize reads reactions from overlay after fold (events.jsonl gone)', () => {
	const state = freshState()
	applyReaction(state, 'reaction_add', VOTER_A)
	applyReaction(state, 'reaction_add', VOTER_B)

	// 模拟 fold：events.jsonl 已无 reaction 事件，仅 overlay 留存状态。
	const rows = synthesizeChannelReactionEvents(state, CHANNEL)
	assertEquals(rows.length, 2)
	assertEquals(rows.every(r => r.type === 'reaction_add' && r.content.targetId === MSG && r.content.emoji === '👍'), true)
	assertEquals(new Set(rows.map(r => r.sender)), new Set([VOTER_A, VOTER_B]))
})

Deno.test('synthesize reflects reaction_remove (cancelled voter dropped)', () => {
	const state = freshState()
	applyReaction(state, 'reaction_add', VOTER_A)
	applyReaction(state, 'reaction_add', VOTER_B)
	applyReaction(state, 'reaction_remove', VOTER_B, { targetPubKeyHash: VOTER_B })

	const rows = synthesizeChannelReactionEvents(state, CHANNEL)
	assertEquals(rows.length, 1)
	assertEquals(rows[0].sender, VOTER_A)
})

Deno.test('synthesize drops emoji key entirely when all voters removed', () => {
	const state = freshState()
	applyReaction(state, 'reaction_add', VOTER_A)
	applyReaction(state, 'reaction_remove', VOTER_A, { targetPubKeyHash: VOTER_A })
	assertEquals(synthesizeChannelReactionEvents(state, CHANNEL), [])
})

Deno.test('synthesize scopes reactions to the target message channel', () => {
	const state = freshState()
	applyReaction(state, 'reaction_add', VOTER_A)
	// 目标消息属于 CHANNEL，查询另一频道应得空结果。
	assertEquals(synthesizeChannelReactionEvents(state, 'channel_other'), [])
	assertEquals(synthesizeChannelReactionEvents(state, CHANNEL).length, 1)
})

Deno.test('synthesize yields stable eventId for unchanged reactions (etag friendly)', () => {
	const state = freshState()
	applyReaction(state, 'reaction_add', VOTER_A)
	const first = synthesizeChannelReactionEvents(state, CHANNEL).map(r => r.eventId).sort()
	const second = synthesizeChannelReactionEvents(state, CHANNEL).map(r => r.eventId).sort()
	assertEquals(first, second)
})

Deno.test('synthesize handles multi-codepoint emoji containing colons', () => {
	const state = freshState()
	messageReducers.reaction_add(state, {
		type: 'reaction_add',
		sender: VOTER_A,
		channelId: CHANNEL,
		content: { targetId: MSG, emoji: ':custom:emoji:' },
	})
	const rows = synthesizeChannelReactionEvents(state, CHANNEL)
	assertEquals(rows.length, 1)
	assertEquals(rows[0].content.emoji, ':custom:emoji:')
	assertEquals(rows[0].content.targetId, MSG)
})
