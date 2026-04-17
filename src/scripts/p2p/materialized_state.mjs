import { AUTHZ_EVENT_TYPES } from './constants.mjs'
import { effectivePermissions } from './permissions.mjs'

/**
 * @param {object} meta 频道元数据（可含 `encryptionScheme` / `encryptionVersion`）
 * @returns {object} 补齐并规范化加密字段后的元数据
 */
function coerceChannelEncryption(meta) {
	if (!meta || typeof meta !== 'object') return meta
	const scheme = meta.encryptionScheme === 'mailbox-ecdh' ? 'mailbox-ecdh' : 'none'
	const v = meta.encryptionVersion
	const encryptionVersion = typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1
	return { ...meta, encryptionScheme: scheme, encryptionVersion }
}

/**
 * 物化群状态（最小实现）：成员、角色、频道、群设置
 * 生产环境应自 Checkpoint 重放增量；此处供单节点内存折叠
 *
 * @returns {object} 空的可变物化状态（成员/角色/频道等均为空容器）
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
			/** @type {string | null} 群默认频道 ID；null 时回退到 'default' */
			defaultChannelId: null,
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
 * 将单条授权类 DAG 事件折叠进物化状态（就地修改并返回同一引用）
 *
 * @param {ReturnType<typeof emptyMaterializedState>} state 当前物化状态
 * @param {object} event DAG 事件（须含 type、content、sender 等）
 * @returns {ReturnType<typeof emptyMaterializedState>} 折叠后的 state（非授权类型则原样返回）
 */
export function foldAuthzEvent(state, event) {
	if (!AUTHZ_EVENT_TYPES.has(event.type)) return state
	const content = event.content || {}
	const sender = event.sender

	switch (event.type) {
		case 'member_join': {
			const pubKey = content.pubKey || content.pubKeyHex
			const hash = content.pubKeyHash || sender
			if (!hash) break
			state.members.set(hash, {
				pubKeyHex: pubKey,
				roles: content.initialRoles || [],
				/** @type {import('../../decl/memberProfile.ts').MemberProfile_t | undefined} */
				profile: content.profile || undefined,
			})
			if (!state.memberRoles.has(hash)) state.memberRoles.set(hash, new Set())
			for (const roleId of content.initialRoles || [])
				state.memberRoles.get(hash).add(roleId)
			break
		}
		case 'member_leave':
		case 'member_kick': {
			const pubKeyHash = content.pubKeyHash || content.targetPubKeyHash
			if (pubKeyHash) {
				state.members.delete(pubKeyHash)
				state.memberRoles.delete(pubKeyHash)
			}
			break
		}
		case 'member_ban': {
			const pubKeyHash = content.pubKeyHash || content.targetPubKeyHash
			if (pubKeyHash) state.banned.add(pubKeyHash)
			break
		}
		case 'member_unban': {
			const pubKeyHash = content.pubKeyHash || content.targetPubKeyHash
			if (pubKeyHash) state.banned.delete(pubKeyHash)
			break
		}
		case 'role_create': {
			const id = content.roleId || content.id || `role_${state.roles.size}`
			state.roles.set(id, {
				name: content.name || id,
				color: content.color || '#99aab5',
				position: content.position ?? 0,
				permissions: content.permissions || {},
				isDefault: !!content.isDefault,
				isHoisted: !!content.isHoisted,
			})
			break
		}
		case 'role_update': {
			const id = content.roleId || content.id
			if (id && state.roles.has(id)) {
				const cur = state.roles.get(id)
				state.roles.set(id, {
					...cur,
					...content,
					permissions: { ...cur.permissions, ...content.permissions },
				})
			}
			break
		}
		case 'role_delete': {
			const id = content.roleId || content.id
			if (id) state.roles.delete(id)
			break
		}
		case 'role_assign': {
			const pubKeyHash = content.pubKeyHash || content.targetPubKeyHash
			const roleId = content.roleId
			if (pubKeyHash && roleId) {
				if (!state.memberRoles.has(pubKeyHash)) state.memberRoles.set(pubKeyHash, new Set())
				state.memberRoles.get(pubKeyHash).add(roleId)
			}
			break
		}
		case 'role_revoke': {
			const pubKeyHash = content.pubKeyHash || content.targetPubKeyHash
			const roleId = content.roleId
			if (pubKeyHash && roleId && state.memberRoles.has(pubKeyHash))
				state.memberRoles.get(pubKeyHash).delete(roleId)
			break
		}
		case 'channel_create': {
			const id = content.channelId || content.id
			if (id)
				state.channels.set(id, coerceChannelEncryption({
					type: content.type === 'text' ? 'chat' : content.type || 'chat',
					name: content.name || id,
					desc: content.desc,
					icon: content.icon,
					parentChannelId: content.parentChannelId,
					syncScope: content.syncScope || 'group',
					isPrivate: !!content.isPrivate,
					subRoomId: content.subRoomId,
					manualItems: content.manualItems,
					permissions: content.permissions || {},
					encryptionScheme: content.encryptionScheme,
					encryptionVersion: content.encryptionVersion,
				}))
			break
		}
		case 'channel_delete': {
			const id = content.channelId || content.id
			if (id) {
				state.channels.delete(id)
				state.channelPermissions.delete(id)
			}
			break
		}
		case 'channel_update': {
			const id = content.channelId || content.id
			const cur = state.channels.get(id)
			if (cur && id) {
				const update = { ...content }
				if (update.type === 'text') update.type = 'chat'
				state.channels.set(id, coerceChannelEncryption({ ...cur, ...update, channelId: id }))
			}
			break
		}
		case 'channel_crypto_migrate': {
			const id = content.channelId || event.channelId
			const cur = id ? state.channels.get(id) : null
			if (cur && id) {
				const ver = content.newVersion != null && Number.isFinite(Number(content.newVersion))
					? Math.max(1, Math.floor(Number(content.newVersion)))
					: 1
				state.channels.set(id, {
					...cur,
					encryptionScheme: String(content.newScheme || cur.encryptionScheme || 'none'),
					encryptionVersion: ver,
				})
			}
			break
		}
		case 'channel_permission_update': {
			// content: { channelId, roleId, allow?: Record<string,boolean>, deny?: Record<string,boolean> }
			// 若 allow/deny 均缺省则清除该角色的频道覆写
			const chId = content.channelId || content.id
			const roleId = content.roleId
			if (!chId || !roleId) break
			if (!state.channelPermissions.has(chId))
				state.channelPermissions.set(chId, new Map())
			const channelPermMap = state.channelPermissions.get(chId)
			if (content.allow == null && content.deny == null)
				channelPermMap.delete(roleId)
			else
				channelPermMap.set(roleId, {
					allow: content.allow || {},
					deny: content.deny || {},
				})
			break
		}
		case 'list_item_update': {
			const id = content.channelId
			const cur = state.channels.get(id)
			if (cur && content.items)
				state.channels.set(id, coerceChannelEncryption({ ...cur, manualItems: content.items }))
			break
		}
		case 'group_meta_update':
			state.groupMeta = { ...state.groupMeta, ...content }
			break
		case 'group_settings_update':
			state.groupSettings = { ...state.groupSettings, ...content }
			break
		case 'home_transfer':
			if (content.proposedHomeNodeId) state.home_node_id = content.proposedHomeNodeId
			break
		case 'encrypted_mailbox_batch': {
			const channelId = content.channelId || event.channelId
			if (channelId != null && content.epoch != null) {
				state.privateMailboxEpochs.set(String(channelId), Number(content.epoch))
				state.privateMailboxLastPostAt.set(String(channelId), Number(event.timestamp) || Date.now())
			}
			break
		}
		case 'owner_heartbeat': {
			const pubKeyHash = content.ownerPubKeyHash || content.pubKeyHash || sender
			if (pubKeyHash) state.ownerHeartbeats.set(String(pubKeyHash), Number(event.timestamp) || Date.now())
			break
		}
		case 'owner_succession_ballot': {
			if (content.proposedOwnerPubKeyHash)
				state.delegatedOwnerPubKeyHash = String(content.proposedOwnerPubKeyHash)
			break
		}
		case 'member_profile_update': {
			const pubKeyHash = content.pubKeyHash || sender
			if (pubKeyHash && state.members.has(pubKeyHash)) {
				const cur = state.members.get(pubKeyHash)
				const { bio, status, background, links, avatar, contextLength } = content
				state.members.set(pubKeyHash, {
					...cur,
					profile: {
						...cur.profile || {},
						...bio !== undefined ? { bio } : {},
						...status !== undefined ? { status } : {},
						...background !== undefined ? { background } : {},
						...links !== undefined ? { links } : {},
						...avatar !== undefined ? { avatar } : {},
						...contextLength !== undefined ? { contextLength } : {},
					},
				})
			}
			break
		}
		case 'file_upload': {
			const fileId = content.fileId || content.id
			if (fileId)
				state.fileIndex.set(String(fileId), {
					name: content.name || '',
					size: Number(content.size) || 0,
					mimeType: content.mimeType,
					folderId: content.folderId,
					chunkManifest: content.chunkManifest,
				})
			break
		}
		case 'file_delete': {
			const fileId = content.fileId || content.id
			if (fileId) state.fileIndex.delete(String(fileId))
			break
		}
		default:
			break
	}
	return state
}

/**
 * 合并角色默认权限与频道覆盖后，某成员在某频道的有效权限
 *
 * @param {ReturnType<typeof emptyMaterializedState>} state 当前物化状态
 * @param {string} pubKeyHash 成员公钥指纹
 * @param {string} channelId 频道 id
 * @returns {Record<string, boolean>} 权限名 → 是否允许
 */
export function memberChannelPermissions(state, pubKeyHash, channelId) {
	const roleIds = [...state.memberRoles.get(pubKeyHash) || []]
	const roleRecords = roleIds
		.map(roleId => state.roles.get(roleId)?.permissions)
		.filter(Boolean)
	const channelOverride = state.channelPermissions.get(channelId) || new Map()
	const mergedAllow = {}
	const mergedDeny = {}
	for (const roleId of roleIds) {
		const ov = channelOverride.get(roleId)
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
 *
 * @param {ReturnType<typeof emptyMaterializedState>} state 当前物化状态
 * @returns {Set<string>} 具备 ADMIN 的成员指纹集合
 */
export function adminPubKeyHashes(state) {
	const out = new Set()
	for (const hash of state.members.keys()) {
		const roleIds = [...state.memberRoles.get(hash) || []]
		const roleRecords = roleIds
			.map(roleId => state.roles.get(roleId)?.permissions)
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

/**
 * 从 checkpoint 快照恢复物化基线（不含 checkpoint 之后的事件；与尾部事件折叠组合即完整状态）
 * @param {object} checkpoint checkpoint.json 解析结果
 * @returns {ReturnType<typeof emptyMaterializedState>} 由快照恢复的物化状态基线
 */
export function materializeFromCheckpoint(checkpoint) {
	const state = emptyMaterializedState()
	if (!checkpoint || typeof checkpoint !== 'object') return state
	state.home_node_id = String(checkpoint.home_node_id || '')
	if (checkpoint.groupMeta && typeof checkpoint.groupMeta === 'object')
		Object.assign(state.groupMeta, checkpoint.groupMeta)
	if (checkpoint.groupSettings && typeof checkpoint.groupSettings === 'object')
		Object.assign(state.groupSettings, checkpoint.groupSettings)
	if (checkpoint.roles && typeof checkpoint.roles === 'object')
		state.roles = new Map(Object.entries(checkpoint.roles))
	if (checkpoint.channels && typeof checkpoint.channels === 'object')
		state.channels = new Map(
			Object.entries(checkpoint.channels).map(([channelId, channelMeta]) => [channelId, coerceChannelEncryption(
				typeof channelMeta === 'object' && channelMeta ? { ...channelMeta } : {},
			)]),
		)
	if (checkpoint.channelPermissions && typeof checkpoint.channelPermissions === 'object') 
		for (const [chId, rolePermissionsByRole] of Object.entries(checkpoint.channelPermissions))
			state.channelPermissions.set(chId, new Map(Object.entries(rolePermissionsByRole || {})))
	
	state.delegatedOwnerPubKeyHash = checkpoint.delegatedOwnerPubKeyHash ?? null
	if (checkpoint.privateMailboxEpochs && typeof checkpoint.privateMailboxEpochs === 'object') 
		for (const [mailboxChannelId, epoch] of Object.entries(checkpoint.privateMailboxEpochs))
			state.privateMailboxEpochs.set(mailboxChannelId, Number(epoch))
	
	const membersRecord = checkpoint.members_record
	if (membersRecord && typeof membersRecord === 'object') {
		state.members = new Map(Object.entries(membersRecord))
		for (const [memberPubKeyHash, memberRecord] of state.members) {
			const roles = Array.isArray(memberRecord.roles) ? memberRecord.roles : []
			state.memberRoles.set(memberPubKeyHash, new Set(roles))
		}
	}
	const overlayFileIndex = checkpoint.messageOverlay?.fileIndex
	if (overlayFileIndex && typeof overlayFileIndex === 'object')
		state.fileIndex = new Map(Object.entries(overlayFileIndex))
	return state
}
