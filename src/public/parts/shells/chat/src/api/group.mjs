import { formatJoinRunUri, wrapProtocolHttpsUrl } from '../../public/shared/runUri.mjs'
import { appendActorEvent } from '../chat/dag/append.mjs'
import { performLocalGroupLeave } from '../chat/dag/leaveMany.mjs'
import { resolveLocalEventSigner } from '../chat/dag/localSigner.mjs'
import { activateGroupFederation, isGroupFederationActive } from '../chat/federation/groupFederation.mjs'
import { roomCredentialsFromGroupSettings } from '../chat/federation/roomCredentials.mjs'
import { collectJoinPowAnchors } from '../chat/governance/joinPowAnchors.mjs'
import { buildConversationContext } from '../chat/lib/conversationContext.mjs'
import { memberEntityHash } from '../chat/lib/entity.mjs'
import { mintGroupInviteTicket } from '../chat/lib/inviteTickets.mjs'
import { getLocalNodeHash } from '../chat/lib/replica.mjs'

import { dispatchBridgeLeave } from './bridgeDispatch.mjs'
import { createChannel } from './channel.mjs'
import { loadGroupState, paginateActiveMembers, resolveActiveMemberKeyByEntityHash } from './internal.mjs'
import { createMember } from './member.mjs'
import { createRole } from './role.mjs'

/**
 * @param {import('./internal.mjs').ChatApiContext} ctx API 上下文
 * @param {string} groupId 群 ID
 * @param {object} projection 1.4 群投影
 * @returns {object} Group 鸭子类型
 */
export function createGroup(ctx, groupId, projection) {
	return {
		id: groupId,
		name: projection.name || groupId,
		kind: projection.kind || 'group',
		memberCount: projection.memberCount ?? 0,
		bridge: projection.bridge,
		/**
		 * @returns {object | undefined} 服务本群的 BridgeBot
		 */
		bridgeBot() {
			const bridge = projection.bridge
			if (!bridge?.platform || !bridge?.botname) return undefined
			return {
				platform: bridge.platform,
				botname: bridge.botname,
				/**
				 * @returns {Promise<void>} 停止本 bot 实例
				 */
				async stop() {
					const { requireBridgeOp } = await import('../chat/bridge/ops.mjs')
					await requireBridgeOp(ctx.username, bridge, 'stopSelf')()
				},
			}
		},
		/**
		 * @returns {Promise<object[]>} 频道列表
		 */
		async channels() {
			const state = await loadGroupState(ctx, groupId)
			return Object.entries(state.channels || {}).map(([channelId, channel]) =>
				createChannel(ctx, groupId, channelId, {
					name: channel.name || channelId,
					kind: channel.parentChannelId && channel.parentEventId ? 'thread' : 'text',
				}))
		},
		/**
		 * @param {string} channelId 频道 ID
		 * @returns {Promise<object>} group_meta_update 事件 Channel
		 */
		async channel(channelId) {
			const { channel } = await buildConversationContext(ctx.username, groupId, channelId)
			return createChannel(ctx, groupId, channelId, channel)
		},
		/**
		 * @returns {Promise<object>} group_meta_update 事件 默认频道
		 */
		async defaultChannel() {
			const state = await loadGroupState(ctx, groupId)
			const channelId = state.groupSettings?.defaultChannelId || 'default'
			return this.channel(channelId)
		},
		/**
		 * @param {{ page?: number }} [opts] 分页
		 * @returns {Promise<{ members: object[], page: number, pageCount: number }>} 分页成员
		 */
		async members(opts = {}) {
			const state = await loadGroupState(ctx, groupId)
			const bridge = state.groupSettings?.bridge
			if (bridge?.platform && bridge?.botname) {
				const { resolveBridgeOps } = await import('../chat/bridge/ops.mjs')
				const { resolveBridgeIdentity } = await import('../chat/bridge/identity.mjs')
				const listMembers = resolveBridgeOps(ctx.username, {
					platform: bridge.platform,
					botname: bridge.botname,
				})?.listMembers
				if (typeof listMembers !== 'function')
					throw new Error(`bridge op not registered: ${bridge.platform}:${bridge.botname}.listMembers`)
				const rows = await listMembers({ platformChatId: bridge.platformChatId })
				const members = await Promise.all((rows || []).map(async row => {
					const entityHash = await resolveBridgeIdentity(
						ctx.username,
						bridge.platform,
						row.platformUserId,
						row.displayName,
					)
					return createMember(ctx, groupId, entityHash, {
						memberKind: 'user',
						displayName: row.displayName || entityHash.slice(64, 72),
						platformUserId: String(row.platformUserId),
						extension: { bridge: { platformUserId: String(row.platformUserId) } },
					})
				}))
				return { page: 1, pageCount: 1, members }
			}
			const { members: slice, page, pageCount } = paginateActiveMembers(state, opts)
			return {
				page,
				pageCount,
				members: slice.map(([key, member]) => {
					const hash = memberEntityHash(member)
					return createMember(ctx, groupId, hash || key, member)
				}),
			}
		},
		/**
		 * @param {string} entityHash 成员 entityHash
		 * @returns {Promise<object | null>} Member
		 */
		async member(entityHash) {
			const state = await loadGroupState(ctx, groupId)
			const key = resolveActiveMemberKeyByEntityHash(state, entityHash)
			if (!key) return null
			const member = state.members[key]
			const hash = memberEntityHash(member) || entityHash
			return createMember(ctx, groupId, hash, member)
		},
		/**
		 * @returns {Promise<object[]>} 角色列表
		 */
		async roles() {
			const state = await loadGroupState(ctx, groupId)
			return Object.entries(state.roles || {}).map(([roleId, role]) =>
				createRole(ctx, groupId, roleId, role))
		},
		/**
		 * @param {string} roleId 角色 ID
		 * @returns {Promise<object | null>} Role
		 */
		async role(roleId) {
			const state = await loadGroupState(ctx, groupId)
			const roleRow = state.roles?.[roleId]
			if (!roleRow) return null
			return createRole(ctx, groupId, roleId, roleRow)
		},
		/**
		 * @param {object} opts 频道参数
		 * @returns {Promise<object>} group_meta_update 事件 新建 Channel
		 */
		async createChannel(opts = {}) {
			const defaultChannel = await this.defaultChannel()
			return defaultChannel._createSibling(opts)
		},
		/**
		 * @returns {Promise<string>} 邀请深链文本
		 */
		async createInvite() {
			const state = await loadGroupState(ctx, groupId)
			const bridge = state.groupSettings?.bridge
			if (bridge?.platform && bridge?.platformChatId) {
				const { requireBridgeOp } = await import('../chat/bridge/ops.mjs')
				return requireBridgeOp(ctx.username, bridge, 'createInvite')({
					platformChatId: bridge.platformChatId,
				})
			}
			const ticket = await mintGroupInviteTicket(ctx.username, groupId)
			const roomCreds = isGroupFederationActive(state.groupSettings)
				? roomCredentialsFromGroupSettings(state.groupSettings)
				: await activateGroupFederation(ctx.username, groupId)
			const { sender: introducerPubKeyHash } = await resolveLocalEventSigner(ctx.username, groupId)
			const powAnchorRef = collectJoinPowAnchors(state)[0] ?? null
			const url = wrapProtocolHttpsUrl(formatJoinRunUri(
				groupId,
				ticket.code,
				roomCreds.roomSecret,
				introducerPubKeyHash,
				powAnchorRef,
				getLocalNodeHash(),
			))
			return url
		},
		/**
		 * @returns {Promise<void>} 退群完成 退群完成
		 */
		async leave() {
			const state = await loadGroupState(ctx, groupId)
			if (state.groupSettings?.bridge)
				await dispatchBridgeLeave(ctx, groupId, state)
			await performLocalGroupLeave(ctx.username, groupId)
		},
		/**
		 * @param {object} patch 元数据补丁
		 * @returns {Promise<object>} group_meta_update 事件
		 */
		async setMeta(patch) {
			return appendActorEvent(ctx.username, groupId, ctx.actor, {
				type: 'group_meta_update',
				timestamp: Date.now(),
				content: patch,
			})
		},
	}
}
