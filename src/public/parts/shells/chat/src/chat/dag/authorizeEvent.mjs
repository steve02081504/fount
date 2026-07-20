/**
 * 【文件】`dag/authorizeEvent.mjs` — 基于物化状态的 DAG 事件权限矩阵。
 * 【职责】按事件类型与频道/治理权限位判断 sender 是否可执行；供 ingest 与联邦 ACL 共用。
 * 【原理】从物化 `state` 解析 `memberChannelPermissions`；消息编辑/删除结合 `messageSenderIndex` 与 overlay 删除集；`group_settings_update` 区分委托 owner 与全量设置变更；角色/频道覆写禁止 MANAGE_ROLES 自提权到 ADMIN；柜绑与 `role_access` 变更须超管。
 * 【数据结构】`checkEventPermission` 返回 `{ ok, reason? }`；`eventChannelId` 归一化频道 id。
 * 【关联】`ingest.mjs`、`materialize.mjs`、`permissions/chat.mjs`。
 */
import { PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'
import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import { governanceChannelId } from '../../group/access.mjs'
import { isVoteBallotClosed } from '../lib/voteBallots.mjs'

import { verifyEntityActivePubKeyBelongs, verifyMemberJoinBinding } from './entityBinding.mjs'
import { FEDERATION_ACL_GATED_EVENT_TYPES } from './eventTypes.mjs'
import { manageAdminsPubKeyHashes, memberChannelPermissions } from './groupMaterializedState.mjs'
import { resolveTargetMemberKey } from './reducers/members.mjs'


/**
 * @param {object} state 物化群状态
 * @param {string} targetId 目标消息 eventId
 * @returns {{ sender: string, charId: string | null, channelId: string } | null} 索引条目；已删或不存在时为 null
 */
function resolveIndexedMessage(state, targetId) {
	const id = String(targetId || '').trim().toLowerCase()
	if (!id) return null
	if (state.messageOverlay?.deletedIds?.has?.(id)) return null
	return state.messageSenderIndex?.[id] || null
}

/**
 * 操作者是否为消息作者的所属主人（成员行 ownerEntityHash；人类与 agent 同构）。
 * @param {object} state 物化群状态
 * @param {string} senderHash 操作者 pubKeyHash
 * @param {string} authorPubKeyHash 消息作者 pubKeyHash
 * @returns {boolean} 是否为所属主人
 */
function isOwnerOfAuthor(state, senderHash, authorPubKeyHash) {
	const author = state.members?.[authorPubKeyHash]
	const senderEntity = String(state.members?.[senderHash]?.entityHash || '').trim().toLowerCase()
	const ownerEntity = String(author?.ownerEntityHash || '').trim().toLowerCase()
	return !!(ownerEntity && senderEntity && senderEntity === ownerEntity)
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
 * 权限 map 是否含超管位（频道覆写 / 角色定义均不可被普通 MANAGE_ROLES 写入）。
 * @param {Record<string, boolean> | null | undefined} perms 权限位
 * @returns {boolean} 是否含 ADMIN 或 MANAGE_ADMINS
 */
function permissionsGrantSuperuser(perms) {
	if (!perms || typeof perms !== 'object') return false
	return !!(perms[PERMISSIONS.ADMIN] || perms[PERMISSIONS.MANAGE_ADMINS])
}

/**
 * 目标权限是否超出授予者已有位（ADMIN 旁路；MANAGE_ADMINS 可授超管位）。
 * @param {Record<string, boolean>} govPerms 授予者治理频道权限
 * @param {Record<string, boolean> | null | undefined} targetPerms 拟写入权限
 * @returns {boolean} 超出则为 true
 */
function permissionsExceedGrantor(govPerms, targetPerms) {
	if (govPerms[PERMISSIONS.ADMIN]) return false
	for (const [name, on] of Object.entries(targetPerms || {})) {
		if (!on) continue
		if ((name === PERMISSIONS.ADMIN || name === PERMISSIONS.MANAGE_ADMINS) && govPerms[PERMISSIONS.MANAGE_ADMINS])
			continue
		if (!govPerms[name]) return true
	}
	return false
}

/**
 * 角色权限写入：超管位须 MANAGE_ADMINS；其余位不可超过授予者。
 * @param {Record<string, boolean>} govPerms 授予者治理权限
 * @param {Record<string, boolean> | null | undefined} existingPerms 原角色权限（update 时）
 * @param {Record<string, boolean> | null | undefined} nextPerms 写入后的权限
 * @returns {{ ok: true } | { ok: false, reason: string }} 校验结果
 */
function checkRolePermissionsMutation(govPerms, existingPerms, nextPerms) {
	if (permissionsGrantSuperuser(existingPerms) || permissionsGrantSuperuser(nextPerms)) 
		if (!govPerms[PERMISSIONS.MANAGE_ADMINS])
			return { ok: false, reason: 'ADMIN/MANAGE_ADMINS role mutation requires MANAGE_ADMINS' }
	
	if (permissionsExceedGrantor(govPerms, nextPerms))
		return { ok: false, reason: 'role permissions exceed grantor' }
	return { ok: true }
}

/**
 * 按物化状态校验事件类型权限（append 与联邦 ACL 共用）。权限主体恒为 sender。
 * @param {object} state 物化群状态
 * @param {{ type?: string, content?: object }} event DAG 事件
 * @param {string} senderHash 发送方 pubKeyHash（小写）
 * @param {{ username?: string }} [options] replica 用户名（member_join 验实体活跃钥归属）
 * @returns {Promise<{ ok: boolean, reason?: string, deferrable?: boolean }>} 是否允许
 */
export async function checkEventPermission(state, event, senderHash, options = {}) {
	const { type } = event
	if (!type) return { ok: false, reason: 'missing event type' }
	if (!FEDERATION_ACL_GATED_EVENT_TYPES.has(type)) return { ok: true }

	const sender = String(senderHash || '').trim().toLowerCase()
	if (!['member_join', 'member_leave'].includes(type) && state.members[sender]?.status !== 'active')
		return { ok: false, reason: 'requires active member sender', deferrable: true }

	// member_join / leave 不依赖频道权限位；先处理以免空 state.channels 炸 governanceChannelId
	if (type === 'member_join') {
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
		const ownership = await verifyEntityActivePubKeyBelongs(
			options.username,
			entityHash,
			entityActivePubKeyHex,
		)
		if (!ownership.ok) 
			return {
				ok: false,
				reason: ownership.reason || 'member_join active key not owned by entity',
				deferrable: ownership.deferrable,
			}
		
		return { ok: true }
	}
	if (type === 'member_leave')
		return { ok: true }

	const channelId = eventChannelId(event)
	const channelPerms = memberChannelPermissions(state, sender, channelId)
	const govPerms = memberChannelPermissions(state, sender, governanceChannelId(state))

	switch (type) {
		case 'member_owner_update':
			// 仅成员本人可改自己的所属声明；活跃成员门控已在上方完成
			return { ok: true }
		case 'member_kick': {
			const targetKey = resolveTargetMemberKey(event.content)
			const target = targetKey ? state.members[targetKey] : null
			const senderEntity = String(state.members[sender]?.entityHash || '').trim().toLowerCase()
			const ownerEntity = String(target?.ownerEntityHash || '').trim().toLowerCase()
			if (ownerEntity && senderEntity === ownerEntity)
				return { ok: true }
			if (target?.memberKind === 'agent') {
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
		case 'role_create': {
			if (!govPerms[PERMISSIONS.MANAGE_ROLES])
				return { ok: false, reason: 'MANAGE_ROLES denied' }
			return checkRolePermissionsMutation(govPerms, null, event.content?.permissions)
		}
		case 'role_update': {
			if (!govPerms[PERMISSIONS.MANAGE_ROLES])
				return { ok: false, reason: 'MANAGE_ROLES denied' }
			const roleId = event.content?.roleId
			const updates = event.content?.updates
			if (updates && Object.hasOwn(updates, 'permissions')) {
				const existing = roleId ? state.roles?.[roleId]?.permissions : null
				return checkRolePermissionsMutation(govPerms, existing, updates.permissions)
			}
			return { ok: true }
		}
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
			if (permissionsGrantSuperuser(targetRole?.permissions) && !govPerms[PERMISSIONS.MANAGE_ADMINS])
				return { ok: false, reason: 'role_assign ADMIN/MANAGE_ADMINS requires MANAGE_ADMINS' }
			return { ok: true }
		}
		case 'channel_create':
		case 'channel_update':
		case 'channel_delete':
			return channelPerms[PERMISSIONS.MANAGE_CHANNELS]
				? { ok: true }
				: { ok: false, reason: 'MANAGE_CHANNELS denied' }
		case 'channel_permissions_update': {
			if (!(govPerms[PERMISSIONS.MANAGE_ROLES] || govPerms[PERMISSIONS.MANAGE_CHANNELS]))
				return { ok: false, reason: 'MANAGE_ROLES or MANAGE_CHANNELS required' }
			const allow = event.content?.allow
			if (permissionsGrantSuperuser(allow))
				return { ok: false, reason: 'channel allow cannot include ADMIN or MANAGE_ADMINS' }
			if (permissionsExceedGrantor(govPerms, allow))
				return { ok: false, reason: 'channel allow exceeds grantor permissions' }
			return { ok: true }
		}
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
			return channelPerms[PERMISSIONS.MANAGE_FILES] || channelPerms[PERMISSIONS.UPLOAD_FILES]
				? { ok: true }
				: { ok: false, reason: 'MANAGE_FILES or UPLOAD_FILES required' }
		case 'file_delete':
			return channelPerms[PERMISSIONS.MANAGE_FILES]
				? { ok: true }
				: { ok: false, reason: 'MANAGE_FILES required' }
		case 'cabinet_bind':
		case 'cabinet_unbind':
			return govPerms[PERMISSIONS.ADMIN] || govPerms[PERMISSIONS.MANAGE_ADMINS]
				? { ok: true }
				: { ok: false, reason: 'ADMIN or MANAGE_ADMINS required' }
		case 'cabinet_key_update': {
			const touchesAccess = event.content?.role_access
				&& typeof event.content.role_access === 'object'
			if (touchesAccess) 
				return govPerms[PERMISSIONS.ADMIN] || govPerms[PERMISSIONS.MANAGE_ADMINS]
					? { ok: true }
					: { ok: false, reason: 'cabinet role_access change requires ADMIN or MANAGE_ADMINS' }
			
			return govPerms[PERMISSIONS.MANAGE_ROLES]
				? { ok: true }
				: { ok: false, reason: 'MANAGE_ROLES required' }
		}
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
			if (isOwnerOfAuthor(state, sender, entry.sender)) return { ok: true }
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
			if (isOwnerOfAuthor(state, sender, entry.sender)) return { ok: true }
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
 * @param {{ username?: string }} [options] replica 用户名（member_join 验实体活跃钥归属）
 * @returns {Promise<void>}
 */
export async function assertEventPermission(state, event, senderHash, options = {}) {
	const { ok, reason, deferrable } = await checkEventPermission(state, event, senderHash, options)
	if (ok) return
	const error = new Error(reason || 'permission denied')
	if (deferrable) error.deferrable = true
	throw error
}
