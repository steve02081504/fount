import { buildConversationContext } from '../../chat/lib/conversationContext.mjs'
import { enumerateJoinedFederatedGroups } from '../../group/queries.mjs'
import { createGroup as hydrateGroup } from '../group.mjs'
import { peerPubKeyFromEntityHash } from '../internal.mjs'

/**
 * @param {import('../internal.mjs').ChatApiContext} apiContext API 上下文
 * @returns {object} 群访问方法
 */
export function createGroupAccessMethods(apiContext) {
	/**
	 * @param {string} groupId 群 ID
	 * @returns {Promise<object>} Group
	 */
	async function group(groupId) {
		const { loadGroupState } = await import('../internal.mjs')
		const state = await loadGroupState(apiContext, groupId)
		const channelId = state.groupSettings?.defaultChannelId || 'default'
		const { group: meta } = await buildConversationContext(apiContext.username, groupId, channelId)
		return hydrateGroup(apiContext, groupId, meta)
	}

	return {
		/**
		 * @returns {Promise<object[]>} 已加入群列表
		 */
		async groups() {
			const rows = await enumerateJoinedFederatedGroups(apiContext.username, apiContext.entityHash)
			return Promise.all(rows.map(async row => {
				const { group: meta } = await buildConversationContext(apiContext.username, row.groupId, row.defaultChannelId || 'default')
				return hydrateGroup(apiContext, row.groupId, meta)
			}))
		},
		group,
		/**
		 * @param {string} peerEntityHash 对端实体（须解析为用户 pubKeyHash）
		 * @returns {Promise<object>} DM Group
		 */
		async openDm(peerEntityHash) {
			const { createEcdhDmGroup } = await import('../../chat/dm/index.mjs')
			const { getEntityActivePubKey } = await import('../../entity/identity.mjs')
			const peerPubKey = peerPubKeyFromEntityHash(peerEntityHash)
			const myPubKey = await getEntityActivePubKey(apiContext.username, apiContext.entityHash)
			const dm = await createEcdhDmGroup(apiContext.username, myPubKey, peerPubKey, { entityHash: apiContext.entityHash })
			const { group: meta } = await buildConversationContext(apiContext.username, dm.groupId, dm.defaultChannelId)
			return hydrateGroup(apiContext, dm.groupId, meta)
		},
		/**
		 * @param {{ name?: string, defaultChannelName?: string, joinPolicy?: string }} [options] 建群参数
		 * @returns {Promise<object>} 新建 Group
		 */
		async createGroup(options = {}) {
			const { newGroup } = await import('../../chat/session/groupLifecycle.mjs')
			const groupId = await newGroup(apiContext.username, { ...options, entityHash: apiContext.entityHash })
			return group(groupId)
		},
		/**
		 * @param {string} groupId 群 ID
		 * @param {object} [options] 加群参数（inviteCode / bootstrap 等）
		 * @returns {Promise<object>} Group
		 */
		async join(groupId, options = {}) {
			const { performMemberJoin } = await import('../../chat/dm/index.mjs')
			const result = await performMemberJoin(apiContext.username, groupId, { ...options, entityHash: apiContext.entityHash })
			return group(result.groupId)
		},
	}
}
