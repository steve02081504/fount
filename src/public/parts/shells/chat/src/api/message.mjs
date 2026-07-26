import { channelMessageAgentText } from '../../public/shared/channelContent.mjs'
import { appendSignedLocalEvent } from '../chat/dag/append.mjs'
import { deriveMessageAttribution } from '../chat/lib/attribution.mjs'
import { messageMentionsEntity } from '../chat/lib/mentionFacts.mjs'
import { memberEntityHash } from '../entity/member.mjs'

import { normalizeReplyContent } from './internal.mjs'
import { createMember } from './member.mjs'

/**
 * ChatClient Message 面向角色的 content 必须是 fount `chatLogEntry_t` 正文（string）。
 * DAG 线格式（`{ type, content, … }`）只留在 `sourceContent`，供壳层/调试读取。
 * @param {unknown} raw line.content
 * @returns {{ content: string, sourceContent: object | undefined }} 规范正文与可选线载荷
 */
function resolveFacingContent(raw) {
	if (typeof raw === 'string') return { content: raw, sourceContent: undefined }
	if (raw && typeof raw === 'object') {
		try {
			if (raw.type)
				return { content: channelMessageAgentText(raw), sourceContent: raw }
		}
		catch { /* 未知 type → 尽量取 text 字段 */ }
		if (typeof raw.content === 'string')
			return { content: raw.content, sourceContent: raw }
		return { content: '', sourceContent: raw }
	}
	return { content: String(raw ?? ''), sourceContent: undefined }
}

/**
 * @param {import('./internal.mjs').ChatApiContext} apiContext API 上下文
 * @param {string} groupId 群 ID
 * @param {object} line 消息行或 OnMessage 事件 message
 * @param {object} [mentions] mentions 结构
 * @returns {object} Message 鸭子类型
 */
export function createMessage(apiContext, groupId, line, mentions) {
	const eventId = String(line.eventId || line.id || '').trim().toLowerCase()
	const channelId = line.channelId || line.extension?.groupChannelId || 'default'
	const { content, sourceContent } = resolveFacingContent(
		line.content != null ? line.content : line.type ? line : undefined,
	)
	const messageMentions = mentions || line.mentions
	const signOptions = { entityHash: apiContext.entityHash }
	const chatLogEntryId = sourceContent?.chatLogEntryId
		|| line.extension?.chatLogEntryId
		|| line.chatLogEntryId

	return {
		eventId,
		channelId,
		/** @type {string} fount chatLogEntry 正文 */
		content,
		/** DAG / 解密后的线载荷；虚拟桥接与已水合 chatLogEntry 通常为 undefined */
		...sourceContent ? { sourceContent } : {},
		files: line.files || [],
		mentions: messageMentions,
		time: line.timestamp || line.time_stamp || Date.now(),
		/**
		 * @returns {Promise<object | null>} 作者 Member；找不到成员时为 null
		 */
		async author() {
			const { loadGroupState } = await import('./internal.mjs')
			const state = await loadGroupState(apiContext, groupId)
			const senderKey = String(line.sender || '').trim().toLowerCase()
			const member = state.members[senderKey]
			if (line.charId) {
				const agentKey = Object.keys(state.members).find(key => {
					const row = state.members[key]
					return row?.memberKind === 'agent' && row.charname === line.charId && row.status === 'active'
				})
				if (agentKey) {
					const agentRow = state.members[agentKey]
					return createMember(apiContext, groupId, memberEntityHash(agentRow), agentRow)
				}
			}
			if (member) {
				const hash = memberEntityHash(member)
				if (hash) return createMember(apiContext, groupId, hash, member)
			}
			// 水合 chatLogEntry：uid / name 已在行上
			const uid = String(line.uid || sourceContent?.extension?.bridge?.authorEntityHash || '').toLowerCase()
			if (uid)
				return createMember(apiContext, groupId, uid, {
					memberKind: line.role === 'char' || line.charId ? 'agent' : 'user',
					displayName: line.name || sourceContent?.displayName || uid.slice(64, 72),
					charname: line.charId,
				})
			return null
		},
		/**
		 * @returns {import('../chat/lib/attribution.mjs').MessageAttribution} 归因
		 */
		attribution() {
			const contentObj = sourceContent && typeof sourceContent === 'object'
				? sourceContent
				: {}
			return deriveMessageAttribution(contentObj, {
				sender: line.sender,
				signerEntityHash: contentObj.importedFrom?.signerEntityHash || null,
			})
		},
		/**
		 * 是否来自本 agent 声明且密码学可信的主人。
		 * @returns {Promise<boolean>} 是否可信主人消息
		 */
		async isFromOwner() {
			const { resolveTrustedOwnerContext } = await import('../entity/master.mjs')
			const { loadGroupState } = await import('./internal.mjs')
			const state = await loadGroupState(apiContext, groupId)
			const author = await this.author()
			const result = await resolveTrustedOwnerContext({
				username: apiContext.username,
				agentEntityHash: apiContext.entityHash,
				eventOrLine: line,
				state,
				authorEntityHash: author?.entityHash || null,
			})
			return result.isFromOwner
		},
		/**
		 * @param {string | object} reply 回复正文
		 * @returns {Promise<object>} 新 Message
		 */
		async reply(reply) {
			const { createChannel } = await import('./channel.mjs')
			return createChannel(apiContext, groupId, channelId).send(reply)
		},
		/**
		 * @param {object} patch 编辑补丁
		 * @returns {Promise<object>} message_edit 事件
		 */
		async edit(patch) {
			const newContent = normalizeReplyContent(patch.content ?? patch)
			return appendSignedLocalEvent(apiContext.username, groupId, {
				type: 'message_edit',
				channelId,
				timestamp: Date.now(),
				content: {
					targetId: eventId,
					newContent,
					...chatLogEntryId ? { chatLogEntryId } : {},
				},
			}, signOptions)
		},
		/**
		 * @returns {Promise<object>} message_delete 事件
		 */
		async delete() {
			return appendSignedLocalEvent(apiContext.username, groupId, {
				type: 'message_delete',
				channelId,
				timestamp: Date.now(),
				content: {
					targetId: eventId,
					...chatLogEntryId ? { chatLogEntryId } : {},
				},
			}, signOptions)
		},
		/**
		 * @param {string} emoji emoji token
		 * @returns {Promise<object>} reaction_add 事件
		 */
		async react(emoji) {
			return appendSignedLocalEvent(apiContext.username, groupId, {
				type: 'reaction_add',
				channelId,
				timestamp: Date.now(),
				content: { targetEventId: eventId, emoji },
			}, signOptions)
		},
		/**
		 * @param {string} emoji emoji token
		 * @returns {Promise<object>} reaction_remove 事件
		 */
		async unreact(emoji) {
			return appendSignedLocalEvent(apiContext.username, groupId, {
				type: 'reaction_remove',
				channelId,
				timestamp: Date.now(),
				content: { targetEventId: eventId, emoji },
			}, signOptions)
		},
		/**
		 * @returns {Promise<object>} pin_message 事件
		 */
		async pin() {
			return appendSignedLocalEvent(apiContext.username, groupId, {
				type: 'pin_message',
				channelId,
				timestamp: Date.now(),
				content: { targetEventId: eventId },
			}, signOptions)
		},
		/**
		 * @returns {Promise<object>} unpin_message 事件
		 */
		async unpin() {
			return appendSignedLocalEvent(apiContext.username, groupId, {
				type: 'unpin_message',
				channelId,
				timestamp: Date.now(),
				content: { targetEventId: eventId },
			}, signOptions)
		},
		/**
		 * @param {string} hash entityHash
		 * @returns {Promise<boolean>} 是否命中
		 */
		async mentionsEntity(hash) {
			return messageMentionsEntity({
				mentions: messageMentions,
				group: { groupId },
				chatReplyRequest: { username: apiContext.username },
			}, hash)
		},
	}
}
