import { createDefaultRoles } from './permissions.mjs'

/**
 * 物化状态管理
 * 从 DAG 事件流折叠出当前群组状态
 */

/**
 * 创建初始状态
 * @param {string} groupId - 群组ID
 * @param {string} creatorPubKeyHash - 创建者公钥哈希
 * @returns {object}
 */
export function createInitialState(groupId, creatorPubKeyHash) {
	const defaultChannelId = `channel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

	return {
		groupId,
		home_node_id: null,
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
				createdAt: Date.now()
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
			joinPolicy: 'open',
			powDifficulty: 4,
			fileSizeLimit: 10 * 1024 * 1024,
			fileQuotaBytes: 2 * 1024 * 1024 * 1024,
			fileUploadPolicy: 'all_members',
			fileReplicationFactor: 2,
			homeCheckpointStaleDays: 7,
			lateMessageFreezeMs: 30000
		},
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
 * @returns {object}
 */
export function applyEvent(state, event) {
	const newState = JSON.parse(JSON.stringify(state))

	// 恢复 Set 和 Map
	newState.messageOverlay.deletedIds = new Set(state.messageOverlay.deletedIds)
	newState.messageOverlay.editHistory = new Map(state.messageOverlay.editHistory)
	newState.messageOverlay.reactionCounts = new Map(state.messageOverlay.reactionCounts)
	newState.messageOverlay.pins = new Map(state.messageOverlay.pins)
	newState.messageOverlay.fileIndex = new Map(state.messageOverlay.fileIndex)
	newState.bannedMembers = new Set(state.bannedMembers)

	switch (event.type) {
		case 'member_join':
			if (!newState.bannedMembers.has(event.sender)) {
				newState.members[event.sender] = {
					pubKeyHash: event.sender,
					roles: ['@everyone'],
					joinedAt: event.timestamp,
					status: 'active'
				}
			}
			break

		case 'member_leave':
			if (newState.members[event.sender]) {
				newState.members[event.sender].status = 'left'
			}
			break

		case 'member_kick':
			if (newState.members[event.content.targetPubKeyHash]) {
				newState.members[event.content.targetPubKeyHash].status = 'kicked'
			}
			break

		case 'member_ban':
			newState.bannedMembers.add(event.content.targetPubKeyHash)
			if (newState.members[event.content.targetPubKeyHash]) {
				newState.members[event.content.targetPubKeyHash].status = 'banned'
			}
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
			if (newState.roles[event.content.roleId]) {
				Object.assign(newState.roles[event.content.roleId], event.content.updates)
			}
			break

		case 'role_delete':
			delete newState.roles[event.content.roleId]
			// 从所有成员中移除该角色
			for (const member of Object.values(newState.members)) {
				member.roles = member.roles.filter(r => r !== event.content.roleId)
			}
			break

		case 'role_assign':
			if (newState.members[event.content.targetPubKeyHash]) {
				if (!newState.members[event.content.targetPubKeyHash].roles.includes(event.content.roleId)) {
					newState.members[event.content.targetPubKeyHash].roles.push(event.content.roleId)
				}
			}
			break

		case 'role_revoke':
			if (newState.members[event.content.targetPubKeyHash]) {
				newState.members[event.content.targetPubKeyHash].roles =
					newState.members[event.content.targetPubKeyHash].roles.filter(r => r !== event.content.roleId)
			}
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
				createdAt: event.timestamp
			}
			break

		case 'channel_update':
			if (newState.channels[event.content.channelId]) {
				Object.assign(newState.channels[event.content.channelId], event.content.updates)
			}
			break

		case 'channel_delete':
			delete newState.channels[event.content.channelId]
			// 删除子频道
			for (const [id, channel] of Object.entries(newState.channels)) {
				if (channel.parentChannelId === event.content.channelId) {
					delete newState.channels[id]
				}
			}
			break

		case 'list_item_update':
			if (newState.channels[event.channelId]) {
				newState.channels[event.channelId].manualItems = event.content.items
			}
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
			if (removeCount > 0) {
				newState.messageOverlay.reactionCounts.set(removeKey, removeCount - 1)
			}
			break

		case 'pin_message':
			if (!newState.messageOverlay.pins.has(event.channelId)) {
				newState.messageOverlay.pins.set(event.channelId, [])
			}
			const pins = newState.messageOverlay.pins.get(event.channelId)
			if (!pins.includes(event.content.targetId)) {
				pins.push(event.content.targetId)
			}
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
			if (newState.fileFolders[event.content.folderId]) {
				newState.fileFolders[event.content.folderId].name = event.content.name
			}
			break

		case 'channel_permissions_update':
			if (!newState.channelPermissions) newState.channelPermissions = {}
			if (!newState.channelPermissions[event.content.channelId]) {
				newState.channelPermissions[event.content.channelId] = {}
			}
			newState.channelPermissions[event.content.channelId][event.content.roleId] = {
				allow: event.content.allow || {},
				deny: event.content.deny || {}
			}
			break

		case 'home_transfer':
			newState.home_node_id = event.content.proposedHomeNodeId
			break
	}

	return newState
}

/**
 * 从事件列表构建状态
 * @param {string} groupId - 群组ID
 * @param {string} creatorPubKeyHash - 创建者公钥哈希
 * @param {Array} events - 事件列表
 * @returns {object}
 */
export function buildStateFromEvents(groupId, creatorPubKeyHash, events) {
	let state = createInitialState(groupId, creatorPubKeyHash)

	for (const event of events) {
		state = applyEvent(state, event)
	}

	return state
}
