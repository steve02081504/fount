import { randomUUID } from 'node:crypto'

import { parseEvfsRef } from 'npm:@steve02081504/fount-p2p/files/evfs_ref'

import { normalizeChannelMessage } from '../../public/shared/channelContent.mjs'
import { listVirtualBridgeTyping, recordVirtualBridgeTyping } from '../chat/bridge/typing.mjs'
import { asUploadBuffer, postChannelMessage } from '../chat/channel/postMessage.mjs'
import { buildConversationContext } from '../chat/lib/conversationContext.mjs'
import { scheduleVoteDeadlines } from '../chat/lib/voteDeadlineWatcher.mjs'
import { broadcastSignedGroupVolatile } from '../chat/session/broadcast.mjs'
import { readViewerChannelMessages } from '../chat/session/materializeViewerLog.mjs'

import { dispatchBridgeTyping } from './bridgeDispatch.mjs'
import { loadGroupState, normalizeReplyContent } from './internal.mjs'
import { createMessage } from './message.mjs'

/**
 * @param {import('./internal.mjs').ChatApiContext} apiContext API 上下文
 * @returns {{ kind: 'char', charname: string, entityHash: string } | { kind: 'user', memberId: string }} 观察者字段
 */
function viewerFieldsFrom(apiContext) {
	return apiContext.charname
		? { kind: 'char', charname: apiContext.charname, entityHash: apiContext.entityHash }
		: { kind: 'user', memberId: apiContext.entityHash }
}

/**
 * @param {import('./internal.mjs').ChatApiContext} apiContext API 上下文
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} [projection] 1.4 频道投影
 * @returns {object} Channel 鸭子类型
 */
export function createChannel(apiContext, groupId, channelId, projection = {}) {
	const signOptions = { entityHash: apiContext.entityHash }
	return {
		id: channelId,
		name: projection.name || channelId,
		kind: projection.kind || 'text',
		/**
		 * @param {string | { text?: string, content?: string, type?: string, files?: Array<{ name?: string, mime_type?: string, buffer: Buffer | Uint8Array | ArrayBuffer }> }} reply 消息正文或带附件载荷
		 * @returns {Promise<object>} Message
		 */
		async send(reply) {
			const charId = apiContext.charname || null
			const origin = charId ? 'char' : 'human'
			/**
			 * @param {Array<{ buffer: Buffer | Uint8Array | ArrayBuffer }> | undefined} files 附件
			 * @returns {Array<{ buffer: Buffer }> | undefined} 规范化缓冲
			 */
			const mapFiles = files => files?.map(file => ({
				...file,
				buffer: typeof file.buffer === 'string' && parseEvfsRef(file.buffer)
					? file.buffer
					: asUploadBuffer(file.buffer),
			}))
			const objectReply = typeof reply === 'object' && reply ? reply : null
			/** @type {object} */
			let postPayload
			if (objectReply?.generated || objectReply?.rawContent)
				postPayload = {
					...objectReply,
					files: mapFiles(objectReply.files),
					origin: objectReply.origin || origin,
					charId: objectReply.charId || charId,
					entityHash: objectReply.entityHash || apiContext.entityHash,
				}
			else {
				const files = Array.isArray(objectReply?.files) ? mapFiles(objectReply.files) : undefined
				postPayload = typeof reply === 'string'
					? {
						text: reply,
						files,
						origin,
						charId,
						entityHash: apiContext.entityHash,
					}
					: {
						rawContent: normalizeReplyContent(reply),
						files,
						origin,
						charId,
						entityHash: apiContext.entityHash,
					}
			}
			const { event } = await postChannelMessage(apiContext.username, groupId, channelId, postPayload)
			// 落盘后 content 是频道密钥密文；发送方持钥，还原明文供调用方直接读取（fileIds 等）。
			const { decryptEventContent } = await import('../chat/channel_keys/content.mjs')
			const decrypted = await decryptEventContent(apiContext.username, groupId, channelId, event.content)
			const message = createMessage(apiContext, groupId, {
				eventId: event.id,
				channelId,
				sender: event.sender,
				charId: event.charId || charId,
				content: decrypted.ok ? decrypted.content : event.content,
				timestamp: event.timestamp,
			})
			message.sourceEvent = event
			message.decryptResult = decrypted
			return message
		},
		/**
		 * @param {string} charname 角色名
		 * @returns {Promise<void>} 无
		 */
		async triggerReply(charname) {
			const { triggerCharReply } = await import('../chat/session/triggerReply.mjs')
			await triggerCharReply(groupId, channelId, charname, null, { replicaUsername: apiContext.username })
		},
		/**
		 * @returns {Promise<{ eventId: string, seq: number } | null>} 当前频道已读水位
		 */
		async readMarker() {
			const { getChannelReadMarker } = await import('../chat/lib/readMarkers.mjs')
			return getChannelReadMarker(apiContext.username, apiContext.entityHash, groupId, channelId)
		},
		/**
		 * @param {{ eventId: string, seq: number }} marker 已读水位
		 * @returns {Promise<{ eventId: string, seq: number } | null>} 写入后的水位
		 */
		async markRead(marker) {
			const { setChannelReadMarker, getChannelReadMarker } = await import('../chat/lib/readMarkers.mjs')
			setChannelReadMarker(apiContext.username, apiContext.entityHash, groupId, channelId, marker)
			return getChannelReadMarker(apiContext.username, apiContext.entityHash, groupId, channelId)
		},
		/**
		 * @returns {Promise<object>} 流媒体鉴权结果（webrtc 或 sfu）
		 */
		async streamingAuth() {
			const { resolveIceServers } = await import('../chat/lib/iceServers.mjs')
			const { appendStreamingSession } = await import('../chat/dag/channelOperations.mjs')
			const { getCurrentFileMasterKey } = await import('../chat/file_keys/store.mjs')
			const { buildStreamingEmbedUrl, mintStreamingViewToken } = await import('../chat/ws/auth.mjs')
			const state = await loadGroupState(apiContext, groupId)
			const channel = state.channels?.[channelId]
			if (!channel) throw new Error('Channel not found')
			if (channel.type !== 'streaming') throw new Error('Channel is not a streaming channel')
			const baseUrl = state.groupSettings?.streamingSfuWss?.trim() || ''
			if (!baseUrl)
				return { mode: 'webrtc', iceServers: resolveIceServers(state.groupSettings) }
			const keyEntry = await getCurrentFileMasterKey(apiContext.username, groupId)
			if (!keyEntry?.fileMasterKey)
				throw new Error('Group encryption (GSH) not initialized')
			const { sessionId, token, expiresAt } = mintStreamingViewToken(
				apiContext.username, groupId, channelId, undefined, keyEntry.fileMasterKey,
			)
			await appendStreamingSession(apiContext.username, groupId, channelId, { sessionId, expiresAt }, apiContext.entityHash)
			return {
				mode: 'sfu',
				sessionId,
				token,
				expiresAt,
				embedUrl: buildStreamingEmbedUrl(baseUrl, token),
			}
		},
		/**
		 * @returns {Promise<void>} 无
		 */
		async typing() {
			recordVirtualBridgeTyping(apiContext.username, groupId, channelId, apiContext.entityHash)
			const state = await loadGroupState(apiContext, groupId)
			if (state.groupSettings?.bridge) {
				await dispatchBridgeTyping(apiContext, groupId, state, channelId)
				return
			}
			await broadcastSignedGroupVolatile(apiContext.username, groupId, {
				type: 'typing',
				groupId,
				channelId,
				memberId: apiContext.entityHash,
			})
		},
		/**
		 * @returns {Promise<string[]>} 当前频道正在输入的 entityHash 列表
		 */
		async typingUsers() {
			return listVirtualBridgeTyping(apiContext.username, groupId, channelId)
		},
		/**
		 * @param {{ limit?: number, before?: string }} [options] 分页
		 * @returns {Promise<object[]>} Message 列表
		 */
		async messages(options = {}) {
			const { messages: rows } = await readViewerChannelMessages(
				apiContext.username,
				groupId,
				channelId,
				{
					limit: options.limit,
					before: options.before,
				},
				viewerFieldsFrom(apiContext),
			)
			return rows.map(row => createMessage(apiContext, groupId, {
				eventId: row.eventId,
				channelId,
				sender: row.sender || row.authorPubKeyHash,
				charId: row.charId,
				content: row.content,
				timestamp: row.timestamp,
			}))
		},
		/**
		 * @returns {Promise<object[]>} 置顶 Message 列表
		 */
		async pins() {
			const state = await loadGroupState(apiContext, groupId)
			const pinIds = state.messageOverlay?.pins?.get(channelId) || []
			if (!pinIds.length) return []
			const { messages: rows } = await readViewerChannelMessages(
				apiContext.username,
				groupId,
				channelId,
				{ eventIds: pinIds },
				viewerFieldsFrom(apiContext),
			)
			return rows.map(row => createMessage(apiContext, groupId, row))
		},
		/**
		 * @param {{ question: string, options: string[], deadline?: string, deadlineMs?: number }} ballot 投票定义
		 * @returns {Promise<object>} ballot Message
		 */
		async startVote(ballot) {
			const question = ballot.question || ''
			const options = Array.isArray(ballot.options)
				? ballot.options.map(option => option).filter(Boolean).slice(0, 12)
				: []
			let voteDeadline = ballot.deadline || null
			if (!voteDeadline && Number.isFinite(Number(ballot.deadlineMs)) && Number(ballot.deadlineMs) > 0)
				voteDeadline = new Date(Date.now() + Number(ballot.deadlineMs)).toISOString()

			const { event } = await postChannelMessage(apiContext.username, groupId, channelId, {
				rawContent: normalizeChannelMessage({
					type: 'vote',
					question,
					options,
					...voteDeadline ? { deadline: new Date(voteDeadline).getTime() } : {},
				}),
				origin: apiContext.charname ? 'char' : 'human',
				charId: apiContext.charname || null,
				entityHash: apiContext.entityHash,
			})
			void scheduleVoteDeadlines(apiContext.username, groupId)
			const message = createMessage(apiContext, groupId, {
				eventId: event.id,
				channelId,
				sender: event.sender,
				content: event.content,
				timestamp: event.timestamp,
			})
			message.sourceEvent = event
			return message
		},
		/**
		 * @param {object} options 频道参数
		 * @returns {Promise<object>} 新建 Channel（由 Group.createChannel 使用）
		 */
		async _createSibling(options) {
			const { createChannel: appendCreateChannel } = await import('../chat/dag/channelOperations.mjs')
			const created = await appendCreateChannel(apiContext.username, groupId, {
				...options,
				channelId: options.channelId || randomUUID(),
			}, signOptions)
			const resolvedId = created.content?.channelId || options.channelId
			const { channel } = await buildConversationContext(apiContext.username, groupId, resolvedId)
			return createChannel(apiContext, groupId, resolvedId, channel)
		},
	}
}
