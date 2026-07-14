import { ensureOperatorPubKey } from '../entity/identity.mjs'
import { buildConversationContext } from '../chat/lib/conversationContext.mjs'
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
		entityHash: ctx.entityHash,
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
			const { createEcdhDmGroup } = await import('../chat/dm/index.mjs')
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
			const { newGroup } = await import('../chat/session/crud.mjs')
			const groupId = await newGroup(ctx.username, opts)
			return this.group(groupId)
		},
		/**
		 * @param {string} groupId 群 ID
		 * @param {object} [opts] 加群参数（inviteCode / bootstrap 等）
		 * @returns {Promise<object>} Group
		 */
		async join(groupId, opts = {}) {
			const { performMemberJoin } = await import('../chat/dm/index.mjs')
			const result = await performMemberJoin(ctx.username, groupId, opts)
			return this.group(result.groupId)
		},
		/**
		 * @param {object} event OnMessage 纯数据事件
		 * @returns {Promise<object>} Message
		 */
		async messageFrom(event) {
			const groupId = event.group?.groupId
			const message = event.message || event
			return createMessage(ctx, groupId, {
				...message,
				channelId: event.channel?.channelId || message.channelId || 'default',
				eventId: message.eventId || message.id || message.extension?.dagEventId,
			}, event.mentions)
		},
		/**
		 * @returns {Promise<object>} 节点级信誉账本
		 */
		async reputation() {
			const { loadReputation } = await import('npm:@steve02081504/fount-p2p/node/reputation_store')
			return loadReputation()
		},
		/**
		 * @returns {{ add: Function, list: Function }} 节点 denylist
		 */
		get nodeDenylist() {
			return {
				/**
				 * @param {{ scope: string, value: string, groupId?: string }} entry denylist 条目
				 * @returns {Promise<object>} 更新后的 denylist
				 */
				async add(entry) {
					const { addDenylistEntry, loadDenylist } = await import('npm:@steve02081504/fount-p2p/node/denylist')
					addDenylistEntry(entry)
					return loadDenylist()
				},
				/**
				 * @returns {Promise<object>} denylist
				 */
				async list() {
					const { loadDenylist } = await import('npm:@steve02081504/fount-p2p/node/denylist')
					return loadDenylist()
				},
			}
		},
		/**
		 * @param {{ name?: string, avatar?: { buffer: Buffer, filename: string, mimeType?: string }, [key: string]: unknown }} updates 资料补丁
		 * @returns {Promise<object>} 更新后的 profile
		 */
		async updateProfile(updates = {}) {
			const { updateProfile, uploadAvatar } = await import('../entity/profile.mjs')
			const { avatar, ...fields } = updates
			if (avatar?.buffer)
				await uploadAvatar(ctx.username, ctx.entityHash, avatar.buffer, avatar.filename || 'avatar.png', avatar.mimeType)
			return updateProfile(ctx.username, ctx.entityHash, fields)
		},
		/**
		 * @returns {Promise<object[]>} 本 user 运行中的 BridgeBot 列表
		 */
		async bridgeBots() {
			const { listBridgeBots } = await import('../chat/bridge/operations.mjs')
			return listBridgeBots(ctx.username).map(row => ({
				platform: row.platform,
				botname: row.botname,
				/**
				 * @returns {Promise<void>} 停止该 bot 实例
				 */
				async stop() {
					const { requireBridgeOperation } = await import('../chat/bridge/operations.mjs')
					await requireBridgeOperation(ctx.username, {
						platform: row.platform,
						botname: row.botname,
					}, 'stopSelf')()
				},
			}))
		},
	}
}

/**
 * 获取以指定实体自签的 ChatClient。
 * @param {string} username replica 登录名
 * @param {string | undefined | null} [entityHash] 缺省 = operator
 * @returns {Promise<object>} ChatClient
 */
export async function getChatClient(username, entityHash) {
	const { resolveChatEntity } = await import('../chat/lib/actor.mjs')
	const entity = await resolveChatEntity(username, entityHash)
	return createChatClient({ username, ...entity })
}
