/**
 * 【文件】`dag/authorizeEvent.mjs` — 基于物化状态的 DAG 事件权限矩阵。
 * 【职责】按事件类型与频道/治理权限位判断 sender 是否可执行；供 ingest 与联邦 ACL 共用。
 * 【原理】从物化 `state` 解析 `memberChannelPermissions`；消息编辑/删除结合 `messageSenderIndex` 与 overlay 删除集；`group_settings_update` 区分委托 owner 与全量设置变更。
 * 【数据结构】`checkEventPermission` 返回 `{ ok, reason? }`；`eventChannelId` 归一化频道 id。
 * 【关联】`ingest.mjs`、`materialize.mjs`、`permissions/chat.mjs`。
 */
import { PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'
import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import { governanceChannelId } from '../../group/access.mjs'
import { isVoteBallotClosed } from '../lib/voteBallots.mjs'

import { verifyMemberJoinBinding } from './entityBinding.mjs'
import { FEDERATION_ACL_GATED_EVENT_TYPES } from './eventTypes.mjs'
import { manageAdminsPubKeyHashes, memberChannelPermissions } from './groupMaterializedState.mjs'
import { resolveTargetMemberKey } from './reducers/helpers.mjs'


/**
 * @param {object} state 物化群状态
 * @param {string} targetId 目标消息 eventId
 * @returns {{ sender: string, charOwner: string | null, charId: string | null, channelId: string } | null} 索引条目；已删或不存在时为 null
 */
function resolveIndexedMessage(state, targetId) {
	const id = String(targetId || '').trim().toLowerCase()
	if (!id) return null
	if (state.messageOverlay?.deletedIds?.has?.(id)) return null
	return state.messageSenderIndex?.[id] || null
}

/**
 * 目标消息是否已知被删除（区别于"目标尚未到达"）。
 * @param {object} state 物化群状态
 * @param {string} targetId 目标消息 eventId（小写）
 * @returns {boolean} 已删除为 true
 */
function isMessageDeleted(state, targetId) {
	const id = String(targetId || '').trim().toLowerCase()
	return Boolean(id && state.messageOverlay?.deletedIds?.has?.(id))
}

/**
 * @param {{ channelId?: string }} event DAG 事件
 * @returns {string} 权限求值用的频道 ID
 */
export function eventChannelId(event) {
	return event.channelId || 'default'
}

/**
 * 按物化状态校验事件类型权限（append 与联邦 ACL 共用）。权限主体恒为 sender。
 * @param {object} state 物化群状态
 * @param {{ type?: string, content?: object }} event DAG 事件
 * @param {string} senderHash 发送方 pubKeyHash（小写）
 * @returns {Promise<{ ok: boolean, reason?: string, deferrable?: boolean }>} 是否允许
 */
export async function checkEventPermission(state, event, senderHash) {
	const { type } = event
	if (!type) return { ok: false, reason: 'missing event type' }
	if (!FEDERATION_ACL_GATED_EVENT_TYPES.has(type)) return { ok: true }

	const sender = String(senderHash || '').trim().toLowerCase()
	if (!['member_join', 'member_leave'].includes(type) && state.members[sender]?.status !== 'active')
		return { ok: false, reason: 'requires active member sender', deferrable: true }

	const channelId = eventChannelId(event)
	const channelPerms = memberChannelPermissions(state, sender, channelId)
	const govPerms = memberChannelPermissions(state, sender, governanceChannelId(state))

	switch (type) {
		case 'member_join': {
			const content = event.content || {}
			const entityHash = String(content.entityHash || '').trim().toLowerCase()
			const entityActivePubKeyHex = String(content.entityActivePubKeyHex || '').trim().toLowerCase()
			const bindingSig = String(content.bindingSig || '').trim().toLowerCase()
			if (!isEntityHash128(entityHash) || !isHex64(entityActivePubKeyHex) || !/^[\da-f]{128}$/u.test(bindingSig))
				return { ok: false, reason: 'invalid member_join binding' }
			const bindOk = await verifyMemberJoinBinding({
				entityHash,
				memberPubKeyHash: sender,
				bindingSig,
				entityActivePubKeyHex,
			})
			if (!bindOk)
				return { ok: false, reason: 'member_join bindingSig invalid' }
			return { ok: true }
		}
		case 'member_leave':
			return { ok: true }
		case 'member_kick': {
			const targetKey = resolveTargetMemberKey(event.content)
			const target = targetKey ? state.members[targetKey] : null
			if (target?.memberKind === 'agent') {
				const senderEntity = String(state.members[sender]?.entityHash || '').trim().toLowerCase()
				const ownerEntity = String(target.ownerEntityHash || '').trim().toLowerCase()
				if (ownerEntity && senderEntity === ownerEntity)
					return { ok: true }
				if (govPerms[PERMISSIONS.ADMIN])
					return { ok: true }
				return { ok: false, reason: 'agent kick denied' }
			}
			return govPerms[PERMISSIONS.KICK_MEMBERS]
				? { ok: true }
				: { ok: false, reason: 'KICK_MEMBERS denied' }
		}
		case 'member_ban':
		case 'member_unban':
			return govPerms[PERMISSIONS.BAN_MEMBERS]
				? { ok: true }
				: { ok: false, reason: 'BAN_MEMBERS denied' }
		case 'role_create':
		case 'role_update':
		case 'role_delete':
		case 'role_revoke':
			return govPerms[PERMISSIONS.MANAGE_ROLES]
				? { ok: true }
				: { ok: false, reason: 'MANAGE_ROLES denied' }
		case 'role_assign': {
			if (!govPerms[PERMISSIONS.MANAGE_ROLES])
				return { ok: false, reason: 'MANAGE_ROLES denied' }
			const assignRoleId = event.content?.roleId
			const targetRole = assignRoleId ? state.roles?.[assignRoleId] : null
			if (targetRole?.permissions?.ADMIN && !govPerms[PERMISSIONS.MANAGE_ADMINS])
				return { ok: false, reason: 'role_assign ADMIN requires MANAGE_ADMINS' }
			return { ok: true }
		}
		case 'channel_create':
		case 'channel_update':
		case 'channel_delete':
			return channelPerms[PERMISSIONS.MANAGE_CHANNELS]
				? { ok: true }
				: { ok: false, reason: 'MANAGE_CHANNELS denied' }
		case 'channel_permissions_update':
			return govPerms[PERMISSIONS.MANAGE_ROLES] || govPerms[PERMISSIONS.MANAGE_CHANNELS]
				? { ok: true }
				: { ok: false, reason: 'MANAGE_ROLES or MANAGE_CHANNELS required' }
		case 'channel_key_rotate':
		case 'channel_key_rotate_batch':
			return channelPerms[PERMISSIONS.MANAGE_CHANNELS] || govPerms[PERMISSIONS.MANAGE_CHANNELS]
				? { ok: true }
				: { ok: false, reason: 'MANAGE_CHANNELS required' }
		case 'state_summary':
			return govPerms[PERMISSIONS.ADMIN]
				? { ok: true }
				: { ok: false, reason: 'ADMIN required' }
		case 'list_item_update':
			return channelPerms[PERMISSIONS.MANAGE_CHANNELS] || channelPerms[PERMISSIONS.CREATE_THREADS]
				? { ok: true }
				: { ok: false, reason: 'MANAGE_CHANNELS or CREATE_THREADS required' }
		case 'group_settings_update': {
			const content = event?.content || {}
			const changedKeys = Object.keys(content).filter(key => content[key] !== undefined)
			const ownerOnly = content.delegatedOwnerPubKeyHash !== undefined
				&& changedKeys.every(key => key === 'delegatedOwnerPubKeyHash')
			if (ownerOnly) {
				const target = String(content.delegatedOwnerPubKeyHash || '').trim().toLowerCase()
				if (isHex64(target) && manageAdminsPubKeyHashes(state).has(target))
					return { ok: true }
				const deferrable = isHex64(target) && state.members[target]?.status === 'active'
				return { ok: false, reason: 'delegatedOwnerPubKeyHash must name an active MANAGE_ADMINS holder', deferrable }
			}
			const onlyDiscovery = changedKeys.every(key => ['discoveryPublic', 'discoveryTitle', 'discoveryBlurb'].includes(key))
			if (onlyDiscovery)
				return govPerms[PERMISSIONS.ADMIN] || govPerms[PERMISSIONS.MANAGE_CHANNELS]
					? { ok: true }
					: { ok: false, reason: 'ADMIN or MANAGE_CHANNELS required for discovery settings' }

			return govPerms[PERMISSIONS.ADMIN] || govPerms[PERMISSIONS.MANAGE_ADMINS]
				? { ok: true }
				: { ok: false, reason: 'ADMIN or MANAGE_ADMINS required' }
		}
		case 'group_meta_update':
			return govPerms[PERMISSIONS.MANAGE_CHANNELS]
				? { ok: true }
				: { ok: false, reason: 'MANAGE_CHANNELS required' }
		case 'file_upload':
		case 'file_system_update':
			return channelPerms[PERMISSIONS.MANAGE_FILES] || channelPerms[PERMISSIONS.UPLOAD_FILES]
				? { ok: true }
				: { ok: false, reason: 'MANAGE_FILES or UPLOAD_FILES required' }
		case 'file_delete':
			return channelPerms[PERMISSIONS.MANAGE_FILES]
				? { ok: true }
				: { ok: false, reason: 'MANAGE_FILES required' }
		case 'pin_message':
		case 'unpin_message':
			return channelPerms[PERMISSIONS.PIN_MESSAGES] || channelPerms[PERMISSIONS.MANAGE_MESSAGES]
				? { ok: true }
				: { ok: false, reason: 'PIN_MESSAGES or MANAGE_MESSAGES required' }
		case 'reputation_slash':
		case 'reputation_reset':
			return govPerms[PERMISSIONS.ADMIN] || govPerms[PERMISSIONS.MANAGE_ROLES]
				? { ok: true }
				: { ok: false, reason: 'ADMIN or MANAGE_ROLES required' }
		case 'file_master_key_rotate':
			return govPerms[PERMISSIONS.ADMIN] || govPerms[PERMISSIONS.MANAGE_ADMINS]
				? { ok: true }
				: { ok: false, reason: 'ADMIN or MANAGE_ADMINS required' }
		case 'peer_invite':
			return govPerms[PERMISSIONS.INVITE_MEMBERS]
				? { ok: true }
				: { ok: false, reason: 'INVITE_MEMBERS denied' }
		case 'vote_cast': {
			if (!channelPerms[PERMISSIONS.SEND_MESSAGES])
				return { ok: false, reason: 'SEND_MESSAGES denied' }
			const ballot = state.voteBallots?.[event.content?.ballotId]
			if (isVoteBallotClosed(ballot, Number(event.hlc?.wall || event.timestamp || Date.now())))
				return { ok: false, reason: 'vote closed' }
			return { ok: true }
		}
		case 'message':
			return channelPerms[PERMISSIONS.SEND_MESSAGES]
				? { ok: true }
				: { ok: false, reason: 'SEND_MESSAGES denied' }
		case 'message_edit': {
			const targetId = String(event.content?.targetId || '').trim().toLowerCase()
			const entry = resolveIndexedMessage(state, targetId)
			if (!entry) return { ok: false, reason: 'message not found', deferrable: !isMessageDeleted(state, targetId) }
			if (entry.sender === sender) return { ok: true }
			if (entry.charOwner && entry.charOwner === sender) return { ok: true }
			return { ok: false, reason: 'message_edit denied' }
		}
		case 'world_state':
			return { ok: true }
		case 'dag_tip_merge':
			return { ok: true }
		case 'message_delete': {
			const targetId = String(event.content?.targetId || '').trim().toLowerCase()
			const entry = resolveIndexedMessage(state, targetId)
			if (!entry) return { ok: false, reason: 'message not found', deferrable: !isMessageDeleted(state, targetId) }
			if (entry.sender === sender) return { ok: true }
			if (entry.charOwner && entry.charOwner === sender) return { ok: true }
			return channelPerms[PERMISSIONS.MANAGE_MESSAGES]
				? { ok: true }
				: { ok: false, reason: 'MANAGE_MESSAGES required' }
		}
		case 'message_feedback': {
			const charOwner = String(event.content?.charOwner || '').trim().toLowerCase()
			return charOwner && charOwner === sender
				? { ok: true }
				: { ok: false, reason: 'message_feedback denied' }
		}
		case 'reaction_add':
			return channelPerms[PERMISSIONS.ADD_REACTIONS]
				? { ok: true }
				: { ok: false, reason: 'ADD_REACTIONS denied' }
		case 'reaction_remove': {
			const reactionActorHash = String(event.content?.targetPubKeyHash || '').trim().toLowerCase()
			if (reactionActorHash && reactionActorHash !== sender)
				return channelPerms[PERMISSIONS.MANAGE_MESSAGES]
					? { ok: true }
					: { ok: false, reason: 'MANAGE_MESSAGES required' }
			return channelPerms[PERMISSIONS.ADD_REACTIONS]
				? { ok: true }
				: { ok: false, reason: 'ADD_REACTIONS denied' }
		}
		default:
			return { ok: false, reason: `unsupported event type: ${type}` }
	}
}

/**
 * @param {object} state 物化群状态
 * @param {{ type?: string, content?: object }} event DAG 事件
 * @param {string} senderHash 发送方 pubKeyHash
 * @returns {Promise<void>}
 */
export async function assertEventPermission(state, event, senderHash) {
	const { ok, reason, deferrable } = await checkEventPermission(state, event, senderHash)
	if (ok) return
	const error = new Error(reason || 'permission denied')
	if (deferrable) error.deferrable = true
	throw error
}
