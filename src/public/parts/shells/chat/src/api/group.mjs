import { formatJoinRunUri, wrapProtocolHttpsUrl } from '../../public/shared/runUri.mjs'
import { appendSignedLocalEvent } from '../chat/dag/append.mjs'
import { performLocalGroupLeave } from '../chat/dag/leaveMany.mjs'
import { resolveLocalEventSigner } from '../chat/dag/localSigner.mjs'
import { activateGroupFederation, isGroupFederationActive } from '../chat/federation/groupFederation.mjs'
import { roomCredentialsFromGroupSettings } from '../chat/federation/roomCredentials.mjs'
import { collectJoinPowAnchors } from '../chat/governance/joinPowAnchors.mjs'
import { buildConversationContext } from '../chat/lib/conversationContext.mjs'
import { mintGroupInviteTicket } from '../chat/lib/inviteTickets.mjs'
import { getLocalNodeHash } from '../chat/lib/replica.mjs'
import { memberEntityHash } from '../entity/member.mjs'

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
					const { requireBridgeOperation } = await import('../chat/bridge/operations.mjs')
					await requireBridgeOperation(ctx.username, bridge, 'stopSelf')()
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
				const { requireBridgeOperation } = await import('../chat/bridge/operations.mjs')
				const { resolveBridgeIdentity } = await import('../chat/bridge/identity.mjs')
				const listMembers = requireBridgeOperation(ctx.username, bridge, 'listMembers')
				const rows = await listMembers({ platformChatId: bridge.platformChatId })
				const members = await Promise.all(rows.map(async row => {
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
						extension: { bridge: { platformUserId: String(row.platformUserId) }},
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
				const { requireBridgeOperation } = await import('../chat/bridge/operations.mjs')
				return requireBridgeOperation(ctx.username, bridge, 'createInvite')({
					platformChatId: bridge.platformChatId,
				})
			}
			const ticket = await mintGroupInviteTicket(ctx.username, groupId)
			const roomCreds = isGroupFederationActive(state.groupSettings)
				? roomCredentialsFromGroupSettings(state.groupSettings)
				: await activateGroupFederation(ctx.username, groupId, ctx.entityHash)
			const { sender: introducerPubKeyHash } = await resolveLocalEventSigner(ctx.username, groupId, ctx.entityHash)
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
		 * @returns {Promise<void>} 退群完成
		 */
		async leave() {
			const state = await loadGroupState(ctx, groupId)
			if (state.groupSettings?.bridge)
				await dispatchBridgeLeave(ctx, groupId, state)
			await performLocalGroupLeave(ctx.username, groupId, ctx.entityHash)
		},
		/**
		 * @param {object} patch 元数据补丁
		 * @returns {Promise<object>} group_meta_update 事件
		 */
		async setMeta(patch) {
			return appendSignedLocalEvent(ctx.username, groupId, {
				type: 'group_meta_update',
				timestamp: Date.now(),
				content: patch,
			}, { entityHash: ctx.entityHash })
		},
		/**
		 * @param {{ tipId?: string, name?: string }} [opts] fork 参数
		 * @returns {Promise<object>} 新 Group
		 */
		async fork(opts = {}) {
			const { forkGroupFromBranch } = await import('../chat/governance/fork.mjs')
			const result = await forkGroupFromBranch(ctx.username, groupId, { ...opts, entityHash: ctx.entityHash })
			const { group } = await buildConversationContext(ctx.username, result.groupId, result.defaultChannelId)
			return createGroup(ctx, result.groupId, group)
		},
		/**
		 * @param {string} acceptedTipId 接受的 tip
		 * @returns {Promise<{ blocked: string[] }>} 阻断结果
		 */
		async blockOpposingFork(acceptedTipId) {
			const { blockOpposingForkBranch } = await import('../chat/governance/forkBlockOpposing.mjs')
			const { sender } = await resolveLocalEventSigner(ctx.username, groupId, ctx.entityHash)
			return blockOpposingForkBranch(ctx.username, groupId, acceptedTipId, sender)
		},
		/**
		 * @returns {{ slash: Function, reset: Function }} 群信誉操作
		 */
		get reputation() {
			const signOpts = { entityHash: ctx.entityHash }
			return {
				/**
				 * @param {{ targetPubKeyHash: string, claim?: number, verified?: boolean, proof?: { eventId: string }}} args slash 参数
				 * @returns {Promise<{ applied: number }>} 应用条数
				 */
				async slash(args) {
					const { appendSignedLocalEvent: append } = await import('../chat/dag/append.mjs')
					const { getState } = await import('../chat/dag/materialize.mjs')
					const { buildAndApplyUnverifiedSlashAlert } = await import('npm:@steve02081504/fount-p2p/node/reputation_store')
					const { publishVolatileToFederation } = await import('../chat/federation/index.mjs')
					const { broadcastEvent } = await import('../chat/ws/groupWsBroadcast.mjs')
					const { groupWsRoomKeyForReplica } = await import('../chat/ws/groupWsRooms.mjs')
					const { canGovSlash, resolveActiveMemberKeyForLocalUser } = await import('../group/access.mjs')
					const content = {
						targetPubKeyHash: String(args.targetPubKeyHash || '').trim().toLowerCase(),
						claim: Number(args.claim ?? 0.25),
					}
					if (args.verified) {
						content.verified = true
						if (args.proof?.eventId) content.proof = { eventId: String(args.proof.eventId).trim().toLowerCase() }
					}
					if (!content.targetPubKeyHash)
						throw new Error('targetPubKeyHash required')
					const { state } = await getState(ctx.username, groupId)
					const memberKey = await resolveActiveMemberKeyForLocalUser(ctx.username, groupId, state, ctx.entityHash)
					const member = memberKey ? state.members[memberKey] : undefined
					if (!content.verified && !content.proof) {
						if (!canGovSlash(state, member))
							throw new Error('ADMIN or MANAGE_ROLES required')
						const { sender } = await resolveLocalEventSigner(ctx.username, groupId, ctx.entityHash)
						const alert = buildAndApplyUnverifiedSlashAlert(sender, content, state.groupSettings || {})
						broadcastEvent(groupWsRoomKeyForReplica(groupId), alert)
						await publishVolatileToFederation(groupId, alert)
						return { applied: 1 }
					}
					await append(ctx.username, groupId, {
						type: 'reputation_slash',
						timestamp: Date.now(),
						content,
					}, signOpts)
					return { applied: 1 }
				},
				/**
				 * @param {string} targetPubKeyHash 目标 pubKeyHash
				 * @returns {Promise<{ applied: number }>} 应用条数
				 */
				async reset(targetPubKeyHash) {
					const hash = String(targetPubKeyHash || '').trim().toLowerCase()
					if (!hash) throw new Error('targetPubKeyHash required')
					await appendSignedLocalEvent(ctx.username, groupId, {
						type: 'reputation_reset',
						timestamp: Date.now(),
						content: { targetPubKeyHash: hash },
					}, signOpts)
					return { applied: 1 }
				},
			}
		},
		/**
		 * @returns {{ catchup: Function, setTuning: Function }} 联邦操作
		 */
		get federation() {
			return {
				/**
				 * @param {{ waitMs?: number, extraWantIds?: string[] }} [opts] catchup 选项
				 * @returns {Promise<object>} catchup 统计
				 */
				async catchup(opts = {}) {
					const { catchUpGroupFromPeers } = await import('../chat/federation/index.mjs')
					return catchUpGroupFromPeers(ctx.username, groupId, opts)
				},
				/**
				 * @param {object} fields 调参字段
				 * @returns {Promise<object>} 写入的 patch
				 */
				async setTuning(fields) {
					const { setFederationTuning } = await import('../chat/federation/tuning.mjs')
					return setFederationTuning(ctx.username, groupId, fields, { entityHash: ctx.entityHash })
				},
			}
		},
		/**
		 * @returns {object} 会话部件配置
		 */
		get session() {
			return {
				/**
				 * @param {string} [personaname] 人格名
				 * @returns {Promise<void>} 无
				 */
				async setPersona(personaname) {
					const { setPersona } = await import('../chat/session/partConfig.mjs')
					await setPersona(groupId, personaname, ctx.username)
				},
				/**
				 * @param {string} channelId 频道
				 * @param {string | null} worldname 世界
				 * @returns {Promise<object | null>} 绑定后的世界配置
				 */
				async bindWorld(channelId, worldname) {
					const { bindWorld } = await import('../chat/session/partConfig.mjs')
					return bindWorld(groupId, channelId, worldname, ctx.username)
				},
				/**
				 * @param {string} pluginname 插件名
				 * @returns {Promise<void>} 无
				 */
				async addPlugin(pluginname) {
					const { addplugin } = await import('../chat/session/partConfig.mjs')
					await addplugin(groupId, pluginname, ctx.username)
				},
				/**
				 * @param {string} pluginname 插件名
				 * @returns {Promise<void>} 无
				 */
				async removePlugin(pluginname) {
					const { removeplugin } = await import('../chat/session/partConfig.mjs')
					await removeplugin(groupId, pluginname, ctx.username)
				},
				/**
				 * @param {string} charname 角色名
				 * @param {object} [opts] 选项
				 * @returns {Promise<object | null>} 加入后的角色配置
				 */
				async addChar(charname, opts) {
					const { addchar } = await import('../chat/session/partConfig.mjs')
					return addchar(groupId, charname, ctx.username, opts)
				},
				/**
				 * @param {string} charname 角色名
				 * @returns {Promise<void>} 无
				 */
				async removeChar(charname) {
					const { removechar } = await import('../chat/session/partConfig.mjs')
					await removechar(groupId, charname, ctx.username)
				},
				/**
				 * @param {string} charname 角色名
				 * @param {number} frequency 频率
				 * @returns {Promise<void>} 无
				 */
				async setCharReplyFrequency(charname, frequency) {
					const { setCharReplyFrequency } = await import('../chat/session/partConfig.mjs')
					await setCharReplyFrequency(groupId, charname, frequency, ctx.username)
				},
			}
		},
	}
}
