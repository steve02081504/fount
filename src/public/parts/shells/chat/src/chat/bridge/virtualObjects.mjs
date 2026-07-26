/**
 * 虚拟桥接群 / 频道 / 消息鸭子对象（ChatClient 消费）。
 */
import { Buffer } from 'node:buffer'

import { deriveMessageAttribution } from '../lib/attribution.mjs'
import { messageMentionsEntity } from '../lib/mentionFacts.mjs'

import { requireBridgeOperation, resolveBridgeOperations } from './operations.mjs'
import { notifyVirtualBridgeOutbound } from './outbound.mjs'
import {
	appendVirtualBridgeCharReply,
	getVirtualBridgeSession,
	lookupVirtualBridgePlatformMessageId,
	resolveVirtualBridgePlatformIds,
} from './session.mjs'
import { listVirtualBridgeTyping, recordVirtualBridgeTyping } from './typing.mjs'

/**
 * @param {import('../../api/internal.mjs').ChatApiContext} apiContext API 上下文
 * @param {string} groupId 虚拟群 ID
 * @returns {object} Group 鸭子类型
 */
export function createVirtualBridgeGroup(apiContext, groupId) {
	const session = getVirtualBridgeSession(apiContext.username, groupId)
	if (!session) throw new Error(`virtual bridge session not found: ${groupId}`)
	const bridge = {
		platform: session.platform,
		platformChatId: session.platformChatId,
		chatKind: session.chatKind,
		...session.botname ? { botname: session.botname } : {},
	}

	return {
		id: groupId,
		name: session.name || groupId,
		kind: session.chatKind === 'dm' ? 'dm' : 'group',
		memberCount: 0,
		bridge,
		/**
		 * @returns {object | undefined} BridgeBot
		 */
		bridgeBot() {
			if (!bridge.botname) return undefined
			return {
				platform: bridge.platform,
				botname: bridge.botname,
				/** @returns {Promise<void>} 停止 bot */
				async stop() {
					await requireBridgeOperation(apiContext.username, bridge, 'stopSelf')()
				},
			}
		},
		/**
		 * @returns {Promise<object[]>} 频道列表
		 */
		async channels() {
			return Object.values(session.channels).map(channel =>
				createVirtualBridgeChannel(apiContext, groupId, channel.channelId))
		},
		/**
		 * @param {string} channelId 频道 ID
		 * @returns {Promise<object>} Channel
		 */
		async channel(channelId) {
			return createVirtualBridgeChannel(apiContext, groupId, channelId)
		},
		/**
		 * @returns {Promise<object>} 默认频道
		 */
		async defaultChannel() {
			return this.channel('default')
		},
		/**
		 * @returns {Promise<{ members: object[], page: number, pageCount: number }>} 成员
		 */
		async members() {
			if (!bridge.botname) return { page: 1, pageCount: 1, members: [] }
			const listMembers = requireBridgeOperation(apiContext.username, bridge, 'listMembers')
			const { resolveBridgeIdentity } = await import('./identity.mjs')
			const { createMember } = await import('../../api/member.mjs')
			const rows = await listMembers({ platformChatId: bridge.platformChatId })
			const members = await Promise.all(rows.map(async row => {
				const entityHash = await resolveBridgeIdentity(
					apiContext.username,
					bridge.platform,
					row.platformUserId,
					row.displayName,
				)
				return createMember(apiContext, groupId, entityHash, {
					memberKind: 'user',
					displayName: row.displayName || entityHash.slice(64, 72),
					platformUserId: String(row.platformUserId),
					extension: { bridge: { platformUserId: String(row.platformUserId) }},
				})
			}))
			return { page: 1, pageCount: 1, members }
		},
		/**
		 * @param {string} entityHash 成员 hash
		 * @returns {Promise<object | null>} Member
		 */
		async member(entityHash) {
			const { members } = await this.members()
			return members.find(row => row.entityHash === String(entityHash).toLowerCase()) || null
		},
		/**
		 * @returns {Promise<object[]>} 空角色列表
		 */
		async roles() { return [] },
		/**
		 * @param {string} [_roleId] 角色 ID
		 * @returns {Promise<object | null>} 无角色
		 */
		async role(_roleId) { return null },
		/**
		 * @returns {Promise<string>} 邀请链接
		 */
		async createInvite() {
			return requireBridgeOperation(apiContext.username, bridge, 'createInvite')({
				platformChatId: bridge.platformChatId,
			})
		},
		/**
		 * @returns {Promise<void>} 退群
		 */
		async leave() {
			await requireBridgeOperation(apiContext.username, bridge, 'leaveChat')({
				platformChatId: bridge.platformChatId,
			})
		},
		/**
		 * @returns {object} 会话部件配置（虚拟群多为 noop）
		 */
		get session() {
			return {
				/** @returns {Promise<null>} 虚拟群无 greeting */
				async addChar() { return null },
				/** @returns {Promise<void>} noop */
				async removeChar() {},
				/** @returns {Promise<void>} noop */
				async setPersona() {},
				/** @returns {Promise<null>} noop */
				async bindWorld() { return null },
				/** @returns {Promise<void>} noop */
				async addPlugin() {},
				/** @returns {Promise<void>} noop */
				async removePlugin() {},
				/** @returns {Promise<void>} noop */
				async setCharReplyFrequency() {},
			}
		},
	}
}

/**
 * @param {import('../../api/internal.mjs').ChatApiContext} apiContext API 上下文
 * @param {string} groupId 虚拟群 ID
 * @param {string} channelId 频道 ID
 * @returns {object} Channel
 */
export function createVirtualBridgeChannel(apiContext, groupId, channelId) {
	const session = getVirtualBridgeSession(apiContext.username, groupId)
	if (!session) throw new Error(`virtual bridge session not found: ${groupId}`)
	const id = String(channelId || 'default').trim() || 'default'
	const bridge = {
		platform: session.platform,
		platformChatId: session.platformChatId,
		...session.botname ? { botname: session.botname } : {},
	}

	return {
		id,
		name: session.channels[id]?.name || id,
		kind: id === 'default' ? 'text' : 'thread',
		/**
		 * @param {string | object} reply 消息
		 * @returns {Promise<object>} Message
		 */
		async send(reply) {
			const charname = apiContext.charname || session.charname
			if (!charname) throw new Error('virtual bridge send requires char actor')
			const objectReply = typeof reply === 'object' && reply ? reply : null
			const text = typeof reply === 'string'
				? reply
				: String(objectReply?.text ?? objectReply?.content ?? '')
			const files = (objectReply?.files || []).map(file => ({
				...file,
				buffer: Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer),
			}))
			const { entry } = appendVirtualBridgeCharReply(
				apiContext.username, groupId, id,
				{ content: text, files, name: charname },
				charname,
				apiContext.entityHash,
			)
			await notifyVirtualBridgeOutbound(apiContext.username, groupId, id, entry, charname)
			return createVirtualBridgeMessage(apiContext, groupId, entry)
		},
		/**
		 * @returns {Promise<void>} typing
		 */
		async typing() {
			recordVirtualBridgeTyping(apiContext.username, groupId, id, apiContext.entityHash)
			if (!bridge.botname) return
			await requireBridgeOperation(apiContext.username, bridge, 'sendTyping')({
				platformChatId: bridge.platformChatId,
				...id !== 'default' ? { platformThreadId: id } : {},
			})
		},
		/**
		 * @returns {Promise<string[]>} 正在输入的 entityHash
		 */
		async typingUsers() {
			return listVirtualBridgeTyping(apiContext.username, groupId, id)
		},
		/**
		 * @param {{ limit?: number }} [options] 分页
		 * @returns {Promise<object[]>} Message 列表
		 */
		async messages(options = {}) {
			const logs = session.channels[id]?.logs || []
			const limit = options.limit || 50
			return logs.slice(-limit).map(entry => createVirtualBridgeMessage(apiContext, groupId, entry))
		},
		/** @returns {Promise<null>} 虚拟群无已读水位 */
		async readMarker() { return null },
		/** @returns {Promise<null>} noop */
		async markRead() { return null },
		/** @returns {Promise<void>} noop — 虚拟群不走 DAG triggerReply */
		async triggerReply() {},
	}
}

/**
 * @param {import('../../api/internal.mjs').ChatApiContext} apiContext API 上下文
 * @param {string} groupId 虚拟群 ID
 * @param {object} entry log 行
 * @param {object} [mentions] mentions
 * @returns {object} Message
 */
export function createVirtualBridgeMessage(apiContext, groupId, entry, mentions) {
	const eventId = String(entry.extension?.chat?.virtualEventId || entry.eventId || '').toLowerCase()
	const channelId = entry.extension?.chat?.channelId || entry.channelId || 'default'
	const content = entry.content
	const authorHash = String(
		entry.uid
		|| entry.extension?.chat?.bridge?.authorEntityHash
		|| '',
	).toLowerCase() || null

	return {
		eventId,
		channelId,
		content,
		files: entry.files || [],
		mentions,
		time: entry.time_stamp || Date.now(),
		/**
		 * @returns {Promise<object | null>} 作者 Member
		 */
		async author() {
			if (!authorHash) return null
			const { createMember } = await import('../../api/member.mjs')
			const session = getVirtualBridgeSession(apiContext.username, groupId)
			return createMember(apiContext, groupId, authorHash, {
				memberKind: entry.role === 'char' ? 'agent' : 'user',
				displayName: entry.name || authorHash.slice(64, 72),
				charname: entry.role === 'char' ? session?.charname : undefined,
				extension: entry.extension?.chat?.bridge
					? { bridge: { platformUserId: entry.extension.chat.bridge.platformUserId } }
					: {},
			})
		},
		/**
		 * @returns {object} 归因
		 */
		attribution() {
			const contentObj = typeof content === 'object' && content
				? content
				: { content: String(content ?? ''), extension: entry.extension }
			return deriveMessageAttribution(contentObj, {
				sender: authorHash,
				signerEntityHash: authorHash,
			})
		},
		/**
		 * @returns {Promise<boolean>} 是否主人
		 */
		async isFromOwner() {
			const { resolveTrustedOwnerContext } = await import('../../entity/master.mjs')
			const result = await resolveTrustedOwnerContext({
				username: apiContext.username,
				agentEntityHash: apiContext.entityHash,
				eventOrLine: entry,
				authorEntityHash: authorHash,
			})
			return result.isFromOwner
		},
		/**
		 * @param {string | object} reply 回复
		 * @returns {Promise<object>} Message
		 */
		async reply(reply) {
			return createVirtualBridgeChannel(apiContext, groupId, channelId).send(reply)
		},
		/** @returns {Promise<void>} 虚拟消息不支持编辑回写平台（壳层走 DTO edit） */
		async edit() {},
		/** @returns {Promise<void>} 同上 */
		async delete() {},
		/** @returns {Promise<void>} noop */
		async react() {},
		/** @returns {Promise<void>} noop */
		async unreact() {},
		/** @returns {Promise<void>} noop */
		async pin() {},
		/** @returns {Promise<void>} noop */
		async unpin() {},
		/**
		 * @param {string} hash entityHash
		 * @returns {Promise<boolean>} 是否命中
		 */
		async mentionsEntity(hash) {
			return messageMentionsEntity({
				mentions,
				group: { groupId },
				chatReplyRequest: { username: apiContext.username },
				message: entry,
			}, hash)
		},
	}
}

/**
 * 解析虚拟桥接群的平台原生上下文（code_execution）。
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @param {string} channelId 频道 ID
 * @param {object | undefined} triggerEntry 触发消息
 * @returns {Promise<(object & { platform: string }) | null>} 原生上下文
 */
export async function hydrateVirtualBridgeNativeContext(username, groupId, channelId, triggerEntry) {
	const ids = resolveVirtualBridgePlatformIds(username, groupId, channelId)
	if (!ids) return null
	const platformMessageId = triggerEntry?.extension?.chat?.bridge?.platformMessageId
	const getNativeContext = ids.botname
		? resolveBridgeOperations(username, { platform: ids.platform, botname: ids.botname })?.getNativeContext
		: undefined
	if (!getNativeContext)
		return { ...ids, platformMessageId }
	return {
		...ids,
		platformMessageId,
		...await getNativeContext({
			platformChatId: ids.platformChatId,
			platformMessageId,
			...ids.platformThreadId ? { platformThreadId: ids.platformThreadId } : {},
		}),
	}
}

/**
 * 出站时反查平台 messageId（供 reply 用）。
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId 虚拟事件 id
 * @returns {string | null} platformMessageId
 */
export function lookupVirtualOutboundReplyTarget(username, groupId, channelId, eventId) {
	const session = getVirtualBridgeSession(username, groupId)
	const channel = session?.channels[channelId]
	if (!channel) return null
	return lookupVirtualBridgePlatformMessageId(channel, eventId)
}
