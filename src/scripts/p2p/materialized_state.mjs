import { AUTHZ_EVENT_TYPES } from './constants.mjs'
import { effectivePermissions } from './permissions.mjs'

/**
 * 物化群状态（最小实现）：成员、角色、频道、群设置
 * 生产环境应自 Checkpoint 重放增量；此处供单节点内存折叠
 */
export function emptyMaterializedState() {
	return {
		members: new Map(), // pubKeyHash -> { pubKeyHex, roles: string[] }
		roles: new Map(), // roleId -> { name, color, position, permissions, isDefault, isHoisted }
		memberRoles: new Map(), // pubKeyHash -> Set<roleId>
		channels: new Map(), // channelId -> meta
		channelPermissions: new Map(), // channelId -> Map<roleId, { allow, deny }>
		groupMeta: { name: '', desc: '', avatar: '' },
		groupSettings: {
			joinPolicy: 'open',
			powDifficulty: 0,
			fileSizeLimit: 100 * 1024 * 1024,
			fileQuotaBytes: 2 * 1024 * 1024 * 1024,
			fileUploadPolicy: 'all_members',
			lateMessageFreezeMs: 30_000,
		},
		home_node_id: '',
		banned: new Set(),
		/** @type {Map<string, number>} channelId → 私密频道 mailbox Epoch（encrypted_mailbox_batch） */
		privateMailboxEpochs: new Map(),
		/** @type {Map<string, number>} channelId → 上次 mailbox 事件时间戳（轮换限速） */
		privateMailboxLastPostAt: new Map(),
		/** @type {Map<string, number>} pubKeyHash → 群主/代理 last heartbeat 时间戳 */
		ownerHeartbeats: new Map(),
		/** @type {Map<string, { name: string, size: number, mimeType?: string, folderId?: string, chunkManifest?: object[] }>} fileId → 元数据（aesKey 仅 Checkpoint 侧，不进 DAG） */
		fileIndex: new Map(),
		/** @type {string | null} owner_succession_ballot 通过后的代理执行官 pubKeyHash（非根密钥转移） */
		delegatedOwnerPubKeyHash: null,
	}
}

/**
 * @param {ReturnType<typeof emptyMaterializedState>} state
 * @param {object} event DAG 事件
 */
export function foldAuthzEvent(state, event) {
	if (!AUTHZ_EVENT_TYPES.has(event.type)) return state
	const c = event.content || {}
	const sender = event.sender

	switch (event.type) {
		case 'member_join': {
			const pubKey = c.pubKey || c.pubKeyHex
			const hash = c.pubKeyHash || sender
			if (!hash) break
			state.members.set(hash, { pubKeyHex: pubKey, roles: c.initialRoles || [] })
			if (!state.memberRoles.has(hash)) state.memberRoles.set(hash, new Set())
			for (const r of c.initialRoles || [])
				state.memberRoles.get(hash).add(r)
			break
		}
		case 'member_leave':
		case 'member_kick': {
			const h = c.pubKeyHash || c.targetPubKeyHash
			if (h) {
				state.members.delete(h)
				state.memberRoles.delete(h)
			}
			break
		}
		case 'member_ban': {
			const h = c.pubKeyHash || c.targetPubKeyHash
			if (h) state.banned.add(h)
			break
		}
		case 'member_unban': {
			const h = c.pubKeyHash || c.targetPubKeyHash
			if (h) state.banned.delete(h)
			break
		}
		case 'role_create': {
			const id = c.roleId || c.id || `role_${state.roles.size}`
			state.roles.set(id, {
				name: c.name || id,
				color: c.color || '#99aab5',
				position: c.position ?? 0,
				permissions: c.permissions || {},
				isDefault: !!c.isDefault,
				isHoisted: !!c.isHoisted,
			})
			break
		}
		case 'role_update': {
			const id = c.roleId || c.id
			if (id && state.roles.has(id)) {
				const cur = state.roles.get(id)
				state.roles.set(id, {
					...cur,
					...c,
					permissions: { ...cur.permissions, ...c.permissions },
				})
			}
			break
		}
		case 'role_delete': {
			const id = c.roleId || c.id
			if (id) state.roles.delete(id)
			break
		}
		case 'role_assign': {
			const h = c.pubKeyHash || c.targetPubKeyHash
			const rid = c.roleId
			if (h && rid) {
				if (!state.memberRoles.has(h)) state.memberRoles.set(h, new Set())
				state.memberRoles.get(h).add(rid)
			}
			break
		}
		case 'role_revoke': {
			const h = c.pubKeyHash || c.targetPubKeyHash
			const rid = c.roleId
			if (h && rid && state.memberRoles.has(h))
				state.memberRoles.get(h).delete(rid)
			break
		}
		case 'channel_create': {
			const id = c.channelId || c.id
			if (id)
				state.channels.set(id, {
					type: c.type || 'text',
					name: c.name || id,
					desc: c.desc,
					parentChannelId: c.parentChannelId,
					syncScope: c.syncScope || 'group',
					isPrivate: !!c.isPrivate,
					subRoomId: c.subRoomId,
					manualItems: c.manualItems,
				})
			break
		}
		case 'channel_delete': {
			const id = c.channelId || c.id
			if (id) {
				state.channels.delete(id)
				state.channelPermissions.delete(id)
			}
			break
		}
		case 'channel_update': {
			const id = c.channelId || c.id
			const cur = state.channels.get(id)
			if (cur && id)
				state.channels.set(id, { ...cur, ...c, channelId: id })
			break
		}
		case 'channel_permission_update': {
			// content: { channelId, roleId, allow?: Record<string,boolean>, deny?: Record<string,boolean> }
			// 若 allow/deny 均缺省则清除该角色的频道覆写
			const chId = c.channelId || c.id
			const roleId = c.roleId
			if (!chId || !roleId) break
			if (!state.channelPermissions.has(chId))
				state.channelPermissions.set(chId, new Map())
			const chMap = state.channelPermissions.get(chId)
			if (c.allow == null && c.deny == null)
				chMap.delete(roleId)
			else
				chMap.set(roleId, {
					allow: c.allow || {},
					deny: c.deny || {},
				})
			break
		}
		case 'list_item_update': {
			const id = c.channelId
			const cur = state.channels.get(id)
			if (cur && c.items)
				state.channels.set(id, { ...cur, manualItems: c.items })
			break
		}
		case 'group_meta_update':
			state.groupMeta = { ...state.groupMeta, ...c }
			break
		case 'group_settings_update':
			state.groupSettings = { ...state.groupSettings, ...c }
			break
		case 'home_transfer':
			if (c.proposedHomeNodeId) state.home_node_id = c.proposedHomeNodeId
			break
		case 'encrypted_mailbox_batch': {
			const ch = c.channelId || event.channelId
			if (ch != null && c.epoch != null) {
				state.privateMailboxEpochs.set(String(ch), Number(c.epoch))
				state.privateMailboxLastPostAt.set(String(ch), Number(event.timestamp) || Date.now())
			}
			break
		}
		case 'owner_heartbeat': {
			const h = c.ownerPubKeyHash || c.pubKeyHash || sender
			if (h) state.ownerHeartbeats.set(String(h), Number(event.timestamp) || Date.now())
			break
		}
		case 'owner_succession_ballot': {
			if (c.proposedOwnerPubKeyHash)
				state.delegatedOwnerPubKeyHash = String(c.proposedOwnerPubKeyHash)
			break
		}
		case 'file_upload': {
			const fid = c.fileId || c.id
			if (fid)
				state.fileIndex.set(String(fid), {
					name: c.name || '',
					size: Number(c.size) || 0,
					mimeType: c.mimeType,
					folderId: c.folderId,
					chunkManifest: c.chunkManifest,
				})
			break
		}
		case 'file_delete': {
			const fid = c.fileId || c.id
			if (fid) state.fileIndex.delete(String(fid))
			break
		}
		default:
			break
	}
	return state
}

/**
 * @param {ReturnType<typeof emptyMaterializedState>} state
 * @param {string} pubKeyHash
 * @param {string} channelId
 */
export function memberChannelPermissions(state, pubKeyHash, channelId) {
	const roleIds = [...(state.memberRoles.get(pubKeyHash) || [])]
	const roleRecords = roleIds
		.map(rid => state.roles.get(rid)?.permissions)
		.filter(Boolean)
	const chOv = state.channelPermissions.get(channelId) || new Map()
	const mergedAllow = {}
	const mergedDeny = {}
	for (const rid of roleIds) {
		const ov = chOv.get(rid)
		if (!ov) continue
		Object.assign(mergedAllow, ov.allow || {})
		Object.assign(mergedDeny, ov.deny || {})
	}
	return effectivePermissions({
		roleRecords,
		channelAllow: mergedAllow,
		channelDeny: mergedDeny,
	})
}

/**
 * 当前物化状态下拥有 ADMIN 的成员 pubKeyHash（用于 home_transfer 阈值验签）
 * @param {ReturnType<typeof emptyMaterializedState>} state
 * @returns {Set<string>}
 */
export function adminPubKeyHashes(state) {
	const out = new Set()
	for (const hash of state.members.keys()) {
		const roleIds = [...(state.memberRoles.get(hash) || [])]
		const roleRecords = roleIds
			.map(rid => state.roles.get(rid)?.permissions)
			.filter(Boolean)
		const perms = effectivePermissions({
			roleRecords,
			channelAllow: {},
			channelDeny: {},
		})
		if (perms.ADMIN === true) out.add(hash)
	}
	return out
}
