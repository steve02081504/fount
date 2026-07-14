import { appendSignedLocalEvent } from '../chat/dag/append.mjs'
import { messageMentionsEntity } from '../chat/lib/mentionFacts.mjs'
import { memberEntityHash } from '../entity/member.mjs'

import { normalizeReplyContent } from './internal.mjs'
import { createMember } from './member.mjs'

/**
 * @param {import('./internal.mjs').ChatApiContext} ctx API 上下文
 * @param {string} groupId 群 ID
 * @param {object} line 消息行或 OnMessage 事件 message
 * @param {object} [mentions] mentions 结构
 * @returns {object} Message 鸭子类型
 */
export function createMessage(ctx, groupId, line, mentions) {
	const eventId = String(line.eventId || line.id || '').trim().toLowerCase()
	const channelId = line.channelId || line.extension?.groupChannelId || 'default'
	const content = line.content || line
	const messageMentions = mentions || line.mentions
	const signOpts = { entityHash: ctx.entityHash }

	return {
		eventId,
		channelId,
		content,
		files: line.files || [],
		mentions: messageMentions,
		time: line.timestamp || line.time_stamp || Date.now(),
		/**
		 * @returns {Promise<object | null>} 作者 Member；找不到成员时为 null
		 */
		async author() {
			const { loadGroupState } = await import('./internal.mjs')
			const state = await loadGroupState(ctx, groupId)
			const senderKey = String(line.sender || '').trim().toLowerCase()
			const member = state.members[senderKey]
			if (line.charId) {
				const agentKey = Object.keys(state.members).find(key => {
					const row = state.members[key]
					return row?.memberKind === 'agent' && row.charname === line.charId && row.status === 'active'
				})
				if (agentKey) {
					const agentRow = state.members[agentKey]
					return createMember(ctx, groupId, memberEntityHash(agentRow), agentRow)
				}
			}
			if (member) {
				const hash = memberEntityHash(member)
				if (hash) return createMember(ctx, groupId, hash, member)
			}
			return null
		},
		/**
		 * @param {string | object} reply 回复正文
		 * @returns {Promise<object>} 新 Message
		 */
		async reply(reply) {
			const { createChannel } = await import('./channel.mjs')
			return createChannel(ctx, groupId, channelId).send(reply)
		},
		/**
		 * @param {object} patch 编辑补丁
		 * @returns {Promise<object>} message_edit 事件
		 */
		async edit(patch) {
			const newContent = normalizeReplyContent(patch.content ?? patch)
			return appendSignedLocalEvent(ctx.username, groupId, {
				type: 'message_edit',
				channelId,
				timestamp: Date.now(),
				content: {
					targetId: eventId,
					newContent,
					chatLogEntryId: content.chatLogEntryId,
				},
			}, signOpts)
		},
		/**
		 * @returns {Promise<object>} message_delete 事件
		 */
		async delete() {
			return appendSignedLocalEvent(ctx.username, groupId, {
				type: 'message_delete',
				channelId,
				timestamp: Date.now(),
				content: {
					targetId: eventId,
					chatLogEntryId: content.chatLogEntryId,
				},
			}, signOpts)
		},
		/**
		 * @param {string} emoji emoji token
		 * @returns {Promise<object>} reaction_add 事件
		 */
		async react(emoji) {
			return appendSignedLocalEvent(ctx.username, groupId, {
				type: 'reaction_add',
				channelId,
				timestamp: Date.now(),
				content: { targetEventId: eventId, emoji },
			}, signOpts)
		},
		/**
		 * @param {string} emoji emoji token
		 * @returns {Promise<object>} reaction_remove 事件
		 */
		async unreact(emoji) {
			return appendSignedLocalEvent(ctx.username, groupId, {
				type: 'reaction_remove',
				channelId,
				timestamp: Date.now(),
				content: { targetEventId: eventId, emoji },
			}, signOpts)
		},
		/**
		 * @returns {Promise<object>} pin_message 事件
		 */
		async pin() {
			return appendSignedLocalEvent(ctx.username, groupId, {
				type: 'pin_message',
				channelId,
				timestamp: Date.now(),
				content: { targetEventId: eventId },
			}, signOpts)
		},
		/**
		 * @returns {Promise<object>} unpin_message 事件
		 */
		async unpin() {
			return appendSignedLocalEvent(ctx.username, groupId, {
				type: 'unpin_message',
				channelId,
				timestamp: Date.now(),
				content: { targetEventId: eventId },
			}, signOpts)
		},
		/**
		 * @param {string} hash entityHash
		 * @returns {Promise<boolean>} 是否命中
		 */
		async mentionsEntity(hash) {
			return messageMentionsEntity({
				mentions: messageMentions,
				group: { groupId },
				chatReplyRequest: { username: ctx.username },
			}, hash)
		},
	}
}
