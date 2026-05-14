import { calculateMemberPermissions, createDefaultRoles, PERMISSIONS } from './permissions.mjs'

/**
 * 将介绍人给出的信誉边值限制在 [-1, 1]。
 * @param {unknown} n 事件中的原始数值
 * @returns {number} 限制后的值；无效输入时为 1
 */
function clampRepEdge(n) {
	if (typeof n !== 'number' || Number.isNaN(n)) return 1
	return Math.max(-1, Math.min(1, n))
}

/**
 * 物化状态管理
 * 从 DAG 事件流折叠出当前群组状态
 */

/**
 * 创建初始状态
 * @param {string} groupId - 群组ID
 * @param {string} creatorPubKeyHash - 创建者公钥哈希
 * @returns {object} 新建群组的初始物化状态
 */
export function createInitialState(groupId, creatorPubKeyHash) {
	const defaultChannelId = `channel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

	return {
		groupId,
		members: {
			[creatorPubKeyHash]: {
				pubKeyHash: creatorPubKeyHash,
				roles: ['admin', '@everyone'],
				joinedAt: Date.now(),
				status: 'active'
			}
		},
		members_root: null,
		members_pages_count: 1,
		roles: createDefaultRoles(),
		channelPermissions: {},
		channels: {
			[defaultChannelId]: {
				id: defaultChannelId,
				type: 'text',
				name: 'general',
				desc: 'General discussion',
				parentChannelId: null,
				syncScope: 'group',
				isPrivate: false,
				createdAt: Date.now(),
				encryptionScheme: 'mailbox-ecdh',
			}
		},
		fileFolders: {},
		groupMeta: {
			name: 'New Group',
			desc: '',
			avatar: null
		},
		groupSettings: {
			defaultChannelId,
			joinPolicy: 'invite-only',
			powDifficulty: 4,
			fileSizeLimit: 10 * 1024 * 1024,
			fileQuotaBytes: 2 * 1024 * 1024 * 1024,
			fileUploadPolicy: 'all_members',
			fileReplicationFactor: 2,
			lateMessageFreezeMs: 30000,
			logicalStreamIdleMs: 150_000,
			plaintextAllowed: false,
			streamingSfuWss: null,
			maxDagPayloadBytes: 262_144,
			mailboxGeneration: 0,
		},
		reputationLedger: [],
		inviteEdges: [],
		messageOverlay: {
			deletedIds: new Set(),
			editHistory: new Map(),
			reactionCounts: new Map(),
			pins: new Map(),
			fileIndex: new Map()
		},
		checkpoint_event_id: null,
		epoch_id: 0,
		epoch_root_hash: null,
		bannedMembers: new Set()
	}
}

/**
 * 应用事件到状态
 * @param {object} state - 当前状态
 * @param {object} event - DAG 事件
 * @returns {object} 应用单条事件后的新状态
 */
export function applyEvent(state, event) {
	const newState = JSON.parse(JSON.stringify(state))
	if (typeof event?.groupId === 'string' && event.groupId)
		newState.groupId = event.groupId

	// 恢复 Set 和 Map
	newState.messageOverlay.deletedIds = new Set(state.messageOverlay.deletedIds)
	newState.messageOverlay.editHistory = new Map(state.messageOverlay.editHistory)
	newState.messageOverlay.reactionCounts = new Map(state.messageOverlay.reactionCounts)
	newState.messageOverlay.pins = new Map(state.messageOverlay.pins)
	newState.messageOverlay.fileIndex = new Map(state.messageOverlay.fileIndex)
	newState.bannedMembers = new Set(state.bannedMembers)

	if (!Array.isArray(newState.reputationLedger)) newState.reputationLedger = []
	if (!Array.isArray(newState.inviteEdges)) newState.inviteEdges = []

	switch (event.type) {
		case 'member_join': {
			if (!newState.bannedMembers.has(event.sender)) {
				const repEdgeFromIntroducer = clampRepEdge(event.content?.rep_edge)
				newState.members[event.sender] = {
					pubKeyHash: event.sender,
					roles: ['@everyone'],
					joinedAt: event.timestamp,
					status: 'active',
					repEdgeFromIntroducer,
				}
			}
			break
		}

		case 'member_leave':
			if (newState.members[event.sender]) 
				newState.members[event.sender].status = 'left'
			
			break

		case 'member_kick':
			if (newState.members[event.content.targetPubKeyHash]) 
				newState.members[event.content.targetPubKeyHash].status = 'kicked'
			
			break

		case 'member_ban':
			newState.bannedMembers.add(event.content.targetPubKeyHash)
			if (newState.members[event.content.targetPubKeyHash]) 
				newState.members[event.content.targetPubKeyHash].status = 'banned'
			
			break

		case 'member_unban':
			newState.bannedMembers.delete(event.content.targetPubKeyHash)
			break

		case 'role_create':
			newState.roles[event.content.roleId] = {
				name: event.content.name,
				color: event.content.color,
				position: event.content.position || 0,
				permissions: event.content.permissions,
				isDefault: false,
				isHoisted: event.content.isHoisted || false
			}
			break

		case 'role_update':
			if (newState.roles[event.content.roleId]) 
				Object.assign(newState.roles[event.content.roleId], event.content.updates)
			
			break

		case 'role_delete':
			delete newState.roles[event.content.roleId]
			// 从所有成员中移除该角色
			for (const member of Object.values(newState.members)) 
				member.roles = member.roles.filter(r => r !== event.content.roleId)
			
			break

		case 'role_assign':
			if (newState.members[event.content.targetPubKeyHash]) 
				if (!newState.members[event.content.targetPubKeyHash].roles.includes(event.content.roleId)) 
					newState.members[event.content.targetPubKeyHash].roles.push(event.content.roleId)
				
			
			break

		case 'role_revoke':
			if (newState.members[event.content.targetPubKeyHash]) 
				newState.members[event.content.targetPubKeyHash].roles =
					newState.members[event.content.targetPubKeyHash].roles.filter(r => r !== event.content.roleId)
			
			break

		case 'channel_create':
			newState.channels[event.content.channelId] = {
				id: event.content.channelId,
				type: event.content.type,
				name: event.content.name,
				desc: event.content.desc || '',
				parentChannelId: event.content.parentChannelId || null,
				syncScope: event.content.syncScope || 'group',
				isPrivate: event.content.isPrivate || false,
				subRoomId: event.content.subRoomId || null,
				createdAt: event.timestamp,
				encryptionScheme: event.content.encryptionScheme,
				encryptionVersion: event.content.encryptionVersion,
			}
			break

		case 'channel_update':
			if (newState.channels[event.content.channelId]) 
				Object.assign(newState.channels[event.content.channelId], event.content.updates)
			
			break

		case 'channel_delete':
			delete newState.channels[event.content.channelId]
			// 删除子频道
			for (const [id, channel] of Object.entries(newState.channels)) 
				if (channel.parentChannelId === event.content.channelId) 
					delete newState.channels[id]
				
			
			break

		case 'list_item_update':
			if (newState.channels[event.channelId]) 
				newState.channels[event.channelId].manualItems = event.content.items
			
			break

		case 'group_meta_update':
			Object.assign(newState.groupMeta, event.content)
			break

		case 'group_settings_update':
			Object.assign(newState.groupSettings, event.content)
			break

		case 'message_delete':
			newState.messageOverlay.deletedIds.add(event.content.targetId)
			break

		case 'message_edit':
			newState.messageOverlay.editHistory.set(event.content.targetId, event.content.newContent)
			break

		case 'reaction_add':
			const reactionKey = `${event.content.targetId}:${event.content.emoji}`
			const currentCount = newState.messageOverlay.reactionCounts.get(reactionKey) || 0
			newState.messageOverlay.reactionCounts.set(reactionKey, currentCount + 1)
			break

		case 'reaction_remove':
			const removeKey = `${event.content.targetId}:${event.content.emoji}`
			const removeCount = newState.messageOverlay.reactionCounts.get(removeKey) || 0
			if (removeCount > 0) 
				newState.messageOverlay.reactionCounts.set(removeKey, removeCount - 1)
			
			break

		case 'pin_message':
			if (!newState.messageOverlay.pins.has(event.channelId)) 
				newState.messageOverlay.pins.set(event.channelId, [])
			
			const pins = newState.messageOverlay.pins.get(event.channelId)
			if (!pins.includes(event.content.targetId)) 
				pins.push(event.content.targetId)
			
			break

		case 'unpin_message':
			if (newState.messageOverlay.pins.has(event.channelId)) {
				const unpins = newState.messageOverlay.pins.get(event.channelId)
				newState.messageOverlay.pins.set(
					event.channelId,
					unpins.filter(id => id !== event.content.targetId)
				)
			}
			break

		case 'file_upload':
			newState.messageOverlay.fileIndex.set(event.content.fileId, {
				aesKey: event.content.aesKey,
				name: event.content.name,
				size: event.content.size,
				mimeType: event.content.mimeType,
				folderId: event.content.folderId,
				chunkManifest: event.content.chunkManifest
			})
			break

		case 'file_delete':
			newState.messageOverlay.fileIndex.delete(event.content.fileId)
			break

		case 'file_folder_create':
			newState.fileFolders[event.content.folderId] = {
				name: event.content.name,
				parentFolderId: event.content.parentFolderId || null
			}
			break

		case 'file_folder_rename':
			if (newState.fileFolders[event.content.folderId]) 
				newState.fileFolders[event.content.folderId].name = event.content.name
			
			break

		case 'channel_permissions_update':
		case 'channel_permission_update':
			if (!newState.channelPermissions) newState.channelPermissions = {}
			if (!newState.channelPermissions[event.content.channelId]) 
				newState.channelPermissions[event.content.channelId] = {}
			
			newState.channelPermissions[event.content.channelId][event.content.roleId] = {
				allow: event.content.allow || {},
				deny: event.content.deny || {}
			}
			break

		case 'reputation_slash': {
			const targetPubKeyHash = event.content?.targetPubKeyHash
			if (typeof targetPubKeyHash === 'string' && targetPubKeyHash) 
				newState.reputationLedger.push({
					targetPubKeyHash,
					sender: event.sender,
					timestamp: event.timestamp,
					kind: 'slash',
					payloadRef: event.id,
				})
			
			break
		}

		case 'reputation_reset': {
			const targetPubKeyHash = event.content?.targetPubKeyHash
			if (typeof targetPubKeyHash === 'string' && targetPubKeyHash) {
				newState.reputationLedger = newState.reputationLedger.filter(
					e => !(e?.kind === 'slash' && e?.targetPubKeyHash === targetPubKeyHash)
				)
				newState.reputationLedger.push({
					targetPubKeyHash,
					sender: event.sender,
					timestamp: event.timestamp,
					kind: 'reset',
				})
			}
			break
		}

		case 'dag_tip_merge':
			// 纯拓扑合并事件：不修改物化成员/频道，仅收敛多父（计划 §0 多父 DAG）。
			break

		case 'peer_invite': {
			const c = event.content && typeof event.content === 'object' ? event.content : {}
			const from = typeof c.from === 'string' && c.from
				? c.from
				: typeof c.introducer === 'string' ? c.introducer : null
			const to = typeof c.to === 'string' && c.to
				? c.to
				: typeof c.invitee === 'string' ? c.invitee : null
			if (from && to) {
				const edge = { from, to, at: event.timestamp }
				if (c.rep_edge !== undefined) edge.rep_edge = clampRepEdge(c.rep_edge)
				newState.inviteEdges.push(edge)
			}
			break
		}
	}

	return newState
}

/**
 * 物化 DAG 单步折叠（与 `applyEvent` 同义；供 chat shell 增量重放使用）。
 * @param {object} state 当前物化状态
 * @param {object} event 单条 DAG 事件
 * @returns {object} 折叠后的新状态
 */
export function foldAuthzEvent(state, event) {
	return applyEvent(state, event)
}

/**
 * 空物化状态（尚无 checkpoint、尚未重放事件时）。
 * @returns {object} 可传入 `foldAuthzEvent` 的初始状态
 */
export function emptyMaterializedState() {
	return {
		groupId: '',
		members: {},
		members_root: null,
		members_pages_count: 1,
		roles: {},
		channelPermissions: {},
		channels: {},
		fileFolders: {},
		groupMeta: { name: '', desc: '', avatar: null },
		groupSettings: {
			defaultChannelId: null,
			joinPolicy: 'invite-only',
			powDifficulty: 4,
			fileSizeLimit: 10 * 1024 * 1024,
			fileQuotaBytes: 2 * 1024 * 1024 * 1024,
			fileUploadPolicy: 'all_members',
			fileReplicationFactor: 2,
			lateMessageFreezeMs: 30_000,
			logicalStreamIdleMs: 150_000,
			plaintextAllowed: false,
			streamingSfuWss: null,
			maxDagPayloadBytes: 262_144,
			mailboxGeneration: 0,
		},
		reputationLedger: [],
		inviteEdges: [],
		messageOverlay: {
			deletedIds: new Set(),
			editHistory: new Map(),
			reactionCounts: new Map(),
			pins: new Map(),
			fileIndex: new Map(),
		},
		checkpoint_event_id: null,
		epoch_id: 0,
		epoch_root_hash: null,
		bannedMembers: new Set(),
		delegatedOwnerPubKeyHash: null,
	}
}

/**
 * 从磁盘 checkpoint 还原运行时物化状态（Set/Map 等）。
 * @param {object} checkpoint `checkpoint.json` 解析对象
 * @returns {object} 与 `applyEvent` 输出同形的物化状态
 */
export function materializeFromCheckpoint(checkpoint) {
	if (!checkpoint || typeof checkpoint !== 'object')
		return emptyMaterializedState()

	const mr = checkpoint.members_record
	if (!mr || typeof mr !== 'object')
		return emptyMaterializedState()

	const rawMo = mr.messageOverlay && typeof mr.messageOverlay === 'object' ? mr.messageOverlay : {}
	const pinsEntries = rawMo.pins
		? Array.isArray(rawMo.pins) ? rawMo.pins : Object.entries(rawMo.pins)
		: []
	const editEntries = rawMo.editHistory
		? Array.isArray(rawMo.editHistory) ? rawMo.editHistory : Object.entries(rawMo.editHistory)
		: []
	const reactEntries = rawMo.reactionCounts
		? Array.isArray(rawMo.reactionCounts) ? rawMo.reactionCounts : Object.entries(rawMo.reactionCounts)
		: []
	const fileEntries = rawMo.fileIndex
		? Array.isArray(rawMo.fileIndex) ? rawMo.fileIndex : Object.entries(rawMo.fileIndex)
		: []

	return {
		groupId: typeof mr.groupId === 'string' ? mr.groupId : '',
		members: mr.members && typeof mr.members === 'object' ? JSON.parse(JSON.stringify(mr.members)) : {},
		members_root: mr.members_root ?? null,
		members_pages_count: typeof mr.members_pages_count === 'number' ? mr.members_pages_count : 1,
		roles: mr.roles && typeof mr.roles === 'object' ? JSON.parse(JSON.stringify(mr.roles)) : {},
		channelPermissions: mr.channelPermissions && typeof mr.channelPermissions === 'object'
			? JSON.parse(JSON.stringify(mr.channelPermissions))
			: {},
		channels: mr.channels && typeof mr.channels === 'object' ? JSON.parse(JSON.stringify(mr.channels)) : {},
		fileFolders: mr.fileFolders && typeof mr.fileFolders === 'object' ? JSON.parse(JSON.stringify(mr.fileFolders)) : {},
		groupMeta: mr.groupMeta && typeof mr.groupMeta === 'object' ? { ...mr.groupMeta } : { name: '', desc: '', avatar: null },
		groupSettings: mr.groupSettings && typeof mr.groupSettings === 'object'
			? { ...emptyMaterializedState().groupSettings, ...mr.groupSettings }
			: { ...emptyMaterializedState().groupSettings },
		messageOverlay: {
			deletedIds: new Set(Array.isArray(rawMo.deletedIds) ? rawMo.deletedIds : []),
			editHistory: new Map(editEntries),
			reactionCounts: new Map(reactEntries),
			pins: new Map(pinsEntries),
			fileIndex: new Map(fileEntries),
		},
		checkpoint_event_id: checkpoint.checkpoint_event_id ?? mr.checkpoint_event_id ?? null,
		epoch_id: checkpoint.epoch_id ?? mr.epoch_id ?? 0,
		epoch_root_hash: checkpoint.epoch_root_hash ?? mr.epoch_root_hash ?? null,
		bannedMembers: new Set(Array.isArray(mr.bannedMembers) ? mr.bannedMembers : []),
		delegatedOwnerPubKeyHash: mr.delegatedOwnerPubKeyHash ?? null,
		reputationLedger: Array.isArray(mr.reputationLedger)
			? JSON.parse(JSON.stringify(mr.reputationLedger))
			: [],
		inviteEdges: Array.isArray(mr.inviteEdges)
			? JSON.parse(JSON.stringify(mr.inviteEdges))
			: [],
	}
}

/**
 * 当前物化状态下具备 `ADMIN` 的成员公钥指纹集合。
 * @param {object} state 物化状态
 * @returns {Set<string>} 管理员 pubKeyHash
 */
export function adminPubKeyHashes(state) {
	const out = new Set()
	if (!state?.members || !state.roles) return out
	for (const [key, m] of Object.entries(state.members)) {
		if (!m || m.status !== 'active') continue
		const hash = m.pubKeyHash || key
		for (const roleId of m.roles || []) {
			const role = state.roles[roleId]
			if (role?.permissions?.ADMIN) {
				out.add(hash)
				break
			}
		}
	}
	return out
}

/**
 * 某成员在某频道上的有效权限表（用于发送前 gate）。
 * @param {object} state 物化状态
 * @param {string} senderPubKeyHash 发送方 pubKeyHash（hex）
 * @param {string} channelId 频道 ID
 * @returns {Record<string, boolean>} 权限键 → 是否允许
 */
export function memberChannelPermissions(state, senderPubKeyHash, channelId) {
	const member = state?.members?.[senderPubKeyHash]
	if (!member || member.status !== 'active')
		return Object.fromEntries(Object.values(PERMISSIONS).map(k => [k, false]))

	return calculateMemberPermissions(
		member,
		state.roles || {},
		channelId,
		state.channelPermissions || {}
	)
}

/**
 * 从事件列表构建状态
 * @param {string} groupId - 群组ID
 * @param {string} creatorPubKeyHash - 创建者公钥哈希
 * @param {Array} events - 事件列表
 * @returns {object} 重放全部事件后的物化状态
 */
export function buildStateFromEvents(groupId, creatorPubKeyHash, events) {
	let state = createInitialState(groupId, creatorPubKeyHash)

	for (const event of events) 
		state = applyEvent(state, event)
	

	return state
}
