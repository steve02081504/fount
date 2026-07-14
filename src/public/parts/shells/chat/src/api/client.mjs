import { ensureOperatorPubKey } from 'fount/server/p2p_server/operator_identity.mjs'

import { createEcdhDmGroup } from '../chat/dm/index.mjs'
import { buildConversationContext } from '../chat/lib/conversationContext.mjs'
import { newGroup } from '../chat/session/crud.mjs'
import { enumerateJoinedFederatedGroups } from '../group/queries.mjs'

import { createGroup as hydrateGroup } from './group.mjs'
import { peerPubKeyFromEntityHash } from './internal.mjs'
import { createMessage } from './message.mjs'

/**
 * @param {import('./internal.mjs').ChatApiContext} ctx API 上下文
 * @returns {object} ChatClient 鸭子类型
 */
export function createChatClient(ctx) {
	return {
		entityHash: ctx.actor.entityHash,
		/**
		 * @returns {Promise<object[]>} 已加入群列表
		 */
		async groups() {
			const rows = await enumerateJoinedFederatedGroups(ctx.username)
			return Promise.all(rows.map(async row => {
				const { group } = await buildConversationContext(ctx.username, row.groupId, row.defaultChannelId || 'default')
				return hydrateGroup(ctx, row.groupId, group)
			}))
		},
		/**
		 * @param {string} groupId 群 ID
		 * @returns {Promise<object>} Group
		 */
		async group(groupId) {
			const { loadGroupState } = await import('./internal.mjs')
			const state = await loadGroupState(ctx, groupId)
			const channelId = state.groupSettings?.defaultChannelId || 'default'
			const { group } = await buildConversationContext(ctx.username, groupId, channelId)
			return hydrateGroup(ctx, groupId, group)
		},
		/**
		 * @param {string} peerEntityHash 对端 entityHash
		 * @returns {Promise<object>} DM Group
		 */
		async openDm(peerEntityHash) {
			const peerPubKey = peerPubKeyFromEntityHash(peerEntityHash)
			const myPubKey = await ensureOperatorPubKey(ctx.username)
			const dm = await createEcdhDmGroup(ctx.username, myPubKey, peerPubKey)
			const { group } = await buildConversationContext(ctx.username, dm.groupId, dm.defaultChannelId)
			return hydrateGroup(ctx, dm.groupId, group)
		},
		/**
		 * @param {{ name?: string, defaultChannelName?: string }} [opts] 建群参数
		 * @returns {Promise<object>} 新建 Group
		 */
		async createGroup(opts = {}) {
			if (ctx.actor.kind === 'agent')
				throw new Error('agent actors cannot create groups')
			const groupId = await newGroup(ctx.username, opts)
			return this.group(groupId)
		},
		/**
		 * @param {object} event OnMessage 纯数据事件
		 * @returns {Promise<object>} Message
		 */
		async messageFrom(event) {
			const groupId = event.group?.groupId
			const channelId = event.channel?.channelId || 'default'
			const message = event.message || event
			return createMessage(ctx, groupId, {
				...message,
				channelId,
				eventId: message.eventId || message.id || message.extension?.dagEventId,
			}, event.mentions)
		},
		/**
		 * @returns {Promise<object[]>} 本 user 运行中的 BridgeBot 列表
		 */
		async bridgeBots() {
			const { listBridgeBots } = await import('../chat/bridge/ops.mjs')
			return listBridgeBots(ctx.username).map(row => ({
				platform: row.platform,
				botname: row.botname,
				/**
				 * @returns {Promise<void>} 停止该 bot 实例
				 */
				async stop() {
					const { requireBridgeOp } = await import('../chat/bridge/ops.mjs')
					await requireBridgeOp(ctx.username, {
						platform: row.platform,
						botname: row.botname,
					}, 'stopSelf')()
				},
			}))
		},
	}
}

/**
 * 获取以 acting entity 归因的 ChatClient。
 * @param {string} username replica 登录名
 * @param {string | undefined | null} [actingEntityHash] 缺省 = operator
 * @returns {Promise<object>} ChatClient
 */
export async function getChatClient(username, actingEntityHash) {
	const { resolveChatActor } = await import('../chat/lib/actor.mjs')
	const actor = await resolveChatActor(username, actingEntityHash)
	return createChatClient({ username, actor })
}
