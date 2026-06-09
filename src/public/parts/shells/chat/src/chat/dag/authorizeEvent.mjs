/**
 * 【文件】`dag/authorizeEvent.mjs` — 基于物化状态的 DAG 事件权限矩阵。
 * 【职责】按事件类型与频道/治理权限位判断 sender 是否可执行；供 ingest 与联邦 ACL 共用。
 * 【原理】从物化 `state` 解析 `memberChannelPermissions`；消息编辑/删除结合 `messageSenderIndex` 与 overlay 删除集；`group_settings_update` 区分委托 owner 与全量设置变更。
 * 【数据结构】`checkEventPermission` 返回 `{ ok, reason? }`；`eventChannelId` 归一化频道 id。
 * 【关联】`ingest.mjs`、`materialize.mjs`、`scripts/p2p/permissions.mjs`。
 */
import { agentEntityHash, isEntityHash128 } from '../../../../../../../scripts/p2p/entity_id.mjs'
import { FEDERATION_ACL_GATED_EVENT_TYPES } from '../../../../../../../scripts/p2p/event_types.mjs'
import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { manageAdminsPubKeyHashes, memberChannelPermissions } from '../../../../../../../scripts/p2p/materialized_state.mjs'
import { PERMISSIONS } from '../../../../../../../scripts/p2p/permissions.mjs'
import { resolveTargetMemberKey } from '../../../../../../../scripts/p2p/reducers/chat/helpers.mjs'
import { governanceChannelId } from '../../group/access.mjs'

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
 * @param {{ channelId?: string }} event DAG 事件
 * @returns {string} 权限求值用的频道 ID
 */
export function eventChannelId(event) {
	return event.channelId || 'default'
}

/**
 * 按物化状态校验事件类型权限（append 与联邦 ACL 共用）。
 * @param {object} state 物化群状态
 * @param {{ type?: string, content?: object }} event DAG 事件
 * @param {string} senderHash 发送方 pubKeyHash（小写）
 * @returns {{ ok: boolean, reason?: string }} 是否允许
 */
export function checkEventPermission(state, event, senderHash) {
	const { type } = event
	if (!type) return { ok: false, reason: 'missing event type' }
	if (!FEDERATION_ACL_GATED_EVENT_TYPES.has(type)) return { ok: true }

	const sender = String(senderHash || '').trim().toLowerCase()
	if (!['member_join', 'member_leave'].includes(type) && state.members[sender]?.status !== 'active')
		return { ok: false, reason: 'requires active member sender' }


	const channelId = eventChannelId(event)
	const channelPerms = memberChannelPermissions(state, sender, channelId)
	const govPerms = memberChannelPermissions(state, sender, governanceChannelId(state))

	switch (type) {
		case 'member_join': {
			const content = event.content || {}
			if (content.memberKind === 'agent') {
				if (state.members[sender]?.status !== 'active')
					return { ok: false, reason: 'requires active member sender' }
				const agentKey = String(content.agentEntityHash || '').trim().toLowerCase()
				const charname = String(content.charname || '').trim()
				const homeNodeHash = content.homeNodeHash
				if (!isEntityHash128(agentKey) || !charname || !isHex64(homeNodeHash))
					return { ok: false, reason: 'invalid agent member_join content' }
				if (agentEntityHash(homeNodeHash, `chars/${charname}`) !== agentKey)
					return { ok: false, reason: 'agentEntityHash mismatch' }
				if (sender === content.ownerPubKeyHash || !content.ownerPubKeyHash)
					return { ok: true }
				if (govPerms[PERMISSIONS.MANAGE_ROLES] || govPerms[PERMISSIONS.ADMIN])
					return { ok: true }
				return { ok: false, reason: 'agent member_join denied' }
			}
			return { ok: true }
		}
		case 'member_leave':
			return { ok: true }
		case 'member_kick': {
			const targetKey = resolveTargetMemberKey(event.content)
			const target = targetKey ? state.members[targetKey] : null
			if (target?.memberKind === 'agent' && target.ownerPubKeyHash === sender)
				return { ok: true }
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
				return { ok: false, reason: 'delegatedOwnerPubKeyHash must name an active MANAGE_ADMINS holder' }
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
		case 'key_rotate':
			return govPerms[PERMISSIONS.ADMIN] || govPerms[PERMISSIONS.MANAGE_ADMINS]
				? { ok: true }
				: { ok: false, reason: 'ADMIN or MANAGE_ADMINS required' }
		case 'peer_invite':
			return govPerms[PERMISSIONS.INVITE_MEMBERS]
				? { ok: true }
				: { ok: false, reason: 'INVITE_MEMBERS denied' }
		case 'vote_cast':
		case 'message':
			return channelPerms[PERMISSIONS.SEND_MESSAGES]
				? { ok: true }
				: { ok: false, reason: 'SEND_MESSAGES denied' }
		case 'message_edit': {
			const targetId = String(event.content?.targetId || '').trim().toLowerCase()
			const entry = resolveIndexedMessage(state, targetId)
			if (!entry) return { ok: false, reason: 'message not found' }
			if (entry.sender === sender) return { ok: true }
			if (entry.charOwner && entry.charOwner === sender) return { ok: true }
			return { ok: false, reason: 'message_edit denied' }
		}
		case 'dag_tip_merge':
			return govPerms[PERMISSIONS.MANAGE_CHANNELS]
				? { ok: true }
				: { ok: false, reason: 'MANAGE_CHANNELS required' }
		case 'message_delete': {
			const targetId = String(event.content?.targetId || '').trim().toLowerCase()
			const entry = resolveIndexedMessage(state, targetId)
			if (!entry) return { ok: false, reason: 'message not found' }
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
 * @returns {void}
 */
export function assertEventPermission(state, event, senderHash) {
	const { ok, reason } = checkEventPermission(state, event, senderHash)
	if (!ok) throw new Error(reason || 'permission denied')
}
