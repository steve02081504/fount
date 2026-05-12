import { createEvent, verifyEventSignature, topologicalSort } from './dag.mjs'
import { HLC } from './hlc.mjs'
import { createInitialState, applyEvent, buildStateFromEvents } from './materialized_state.mjs'
import { hasPermission, PERMISSIONS } from './permissions.mjs'
import { createCheckpoint, saveCheckpoint, loadCheckpoint } from './checkpoint.mjs'
import { appendEvent, appendMessage, readEvents, readMessages, getLastEvent } from './event_storage.mjs'
import { RateLimiter, generateChallenge, verifyChallenge } from './pow.mjs'
import { StorageManager } from './storage.mjs'

/**
 * P2P 群聊核心管理器
 */
export class P2PGroupManager {
	constructor(config = {}) {
		this.groups = new Map()
		this.rateLimiter = new RateLimiter(config.rateLimiter)
		this.storageManager = new StorageManager(config.storage)
		this.hlc = new HLC()
		this.nodeId = config.nodeId || crypto.randomUUID()
		this.challenges = new Map()
	}

	/**
	 * 创建新群组
	 * @param {object} params - 群组参数
	 * @returns {Promise<object>}
	 */
	async createGroup(params) {
		const { creatorPubKeyHash, privateKey, name, description } = params
		const groupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

		// 创建初始状态
		const state = createInitialState(groupId, creatorPubKeyHash)
		state.home_node_id = this.nodeId
		state.groupMeta.name = name || 'New Group'
		state.groupMeta.desc = description || ''

		// 创建初始事件
		const event = await createEvent({
			type: 'group_meta_update',
			groupId,
			channelId: null,
			sender: creatorPubKeyHash,
			content: {
				name: state.groupMeta.name,
				desc: state.groupMeta.desc
			},
			prev_event_id: null,
			privateKey,
			hlc: this.hlc.tick()
		})

		// 保存事件
		await appendEvent(groupId, event)

		// 应用事件到状态
		const newState = applyEvent(state, event)
		newState.checkpoint_event_id = event.id

		// 创建并保存 Checkpoint
		const checkpoint = createCheckpoint(newState, [event])
		await saveCheckpoint(groupId, checkpoint)

		// 缓存状态
		this.groups.set(groupId, newState)

		return {
			groupId,
			defaultChannelId: newState.groupSettings.defaultChannelId,
			checkpoint
		}
	}

	/**
	 * 加入群组
	 * @param {object} params - 加入参数
	 * @returns {Promise<object>}
	 */
	async joinGroup(params) {
		const { groupId, pubKeyHash, privateKey, inviteCode, pow } = params

		// 加载群组状态
		let state = this.groups.get(groupId)
		if (!state) {
			const checkpoint = await loadCheckpoint(groupId)
			if (checkpoint) {
				state = await this.restoreFromCheckpoint(groupId)
			} else {
				throw new Error('Group not found')
			}
		}

		// 检查入群策略
		if (state.groupSettings.joinPolicy === 'invite-only' && !inviteCode) {
			throw new Error('Invite code required')
		}

		if (state.groupSettings.joinPolicy === 'pow') {
			if (!pow || !pow.challenge || !pow.nonce) {
				throw new Error('PoW required')
			}

			const isValid = await verifyChallenge(
				pow.challenge,
				pow.nonce,
				state.groupSettings.powDifficulty
			)

			if (!isValid) {
				throw new Error('Invalid PoW')
			}
		}

		// 检查是否已被封禁
		if (state.bannedMembers.has(pubKeyHash)) {
			throw new Error('User is banned')
		}

		// 创建加入事件
		const lastEvent = await getLastEvent(groupId)
		const event = await createEvent({
			type: 'member_join',
			groupId,
			channelId: null,
			sender: pubKeyHash,
			content: {
				pubKey: pubKeyHash,
				inviteCode
			},
			prev_event_id: lastEvent?.id || null,
			privateKey,
			hlc: this.hlc.tick()
		})

		// 保存并应用事件
		await appendEvent(groupId, event)
		state = applyEvent(state, event)
		this.groups.set(groupId, state)

		return {
			success: true,
			groupId,
			defaultChannelId: state.groupSettings.defaultChannelId
		}
	}

	/**
	 * 发送消息
	 * @param {object} params - 消息参数
	 * @returns {Promise<object>}
	 */
	async sendMessage(params) {
		const { groupId, channelId, sender, privateKey, content, charId } = params

		// 加载群组状态
		let state = this.groups.get(groupId)
		if (!state) {
			state = await this.getGroupState(groupId)
		}
		if (!state) {
			throw new Error('Group not found')
		}

		// 检查权限
		const member = state.members[sender]
		if (!member || member.status !== 'active') {
			throw new Error('Not a member')
		}

		const canSend = hasPermission(
			member,
			PERMISSIONS.SEND_MESSAGES,
			state.roles,
			channelId,
			state.channelPermissions
		)

		if (!canSend) {
			throw new Error('No permission to send messages')
		}

		// 创建消息事件
		const lastEvent = await getLastEvent(groupId)
		const event = await createEvent({
			type: 'message',
			groupId,
			channelId,
			sender,
			charId,
			content,
			prev_event_id: lastEvent?.id || null,
			privateKey,
			hlc: this.hlc.tick()
		})

		// 保存事件
		await appendEvent(groupId, event)
		await appendMessage(groupId, channelId, event)

		return event
	}

	/**
	 * 处理接收到的事件
	 * @param {object} event - 事件对象
	 * @returns {Promise<boolean>}
	 */
	async handleIncomingEvent(event) {
		// 验证签名
		const isValid = await verifyEventSignature(event)
		if (!isValid) {
			console.error('Invalid event signature:', event.id)
			return false
		}

		// 加载群组状态
		let state = this.groups.get(event.groupId)
		if (!state) {
			const checkpoint = await loadCheckpoint(event.groupId)
			if (checkpoint) {
				state = await this.restoreFromCheckpoint(event.groupId)
			} else {
				console.error('Group not found:', event.groupId)
				return false
			}
		}

		// 检查权限
		if (event.type !== 'member_join') {
			const member = state.members[event.sender]
			if (!member || member.status !== 'active') {
				console.error('Sender not a member:', event.sender)
				return false
			}
		}

		// 添加接收时间
		event.received_at = Date.now()
		event.isRemote = true

		// 保存事件
		await appendEvent(event.groupId, event)

		if (event.type === 'message' && event.channelId) {
			await appendMessage(event.groupId, event.channelId, event)
		}

		// 应用到状态
		state = applyEvent(state, event)
		this.groups.set(event.groupId, state)

		// 更新 HLC
		if (event.hlc) {
			this.hlc = this.hlc.update(HLC.fromJSON(event.hlc))
		}

		return true
	}

	/**
	 * 获取群组状态
	 * @param {string} groupId - 群组ID
	 * @returns {Promise<object>}
	 */
	async getGroupState(groupId) {
		let state = this.groups.get(groupId)

		if (!state) {
			state = await this.restoreFromCheckpoint(groupId)
		}

		return state
	}

	/**
	 * 从 Checkpoint 恢复状态
	 * @param {string} groupId - 群组ID
	 * @returns {Promise<object>}
	 */
	async restoreFromCheckpoint(groupId) {
		const checkpoint = await loadCheckpoint(groupId)
		if (!checkpoint) {
			throw new Error('No checkpoint found')
		}

		// 恢复基础状态
		let state = {
			groupId: checkpoint.groupId,
			home_node_id: checkpoint.home_node_id,
			members: {},
			members_root: checkpoint.members_root,
			members_pages_count: checkpoint.members_pages_count,
			roles: checkpoint.roles,
			channelPermissions: checkpoint.channelPermissions,
			channels: checkpoint.channels,
			fileFolders: checkpoint.fileFolders,
			groupMeta: checkpoint.groupMeta,
			groupSettings: checkpoint.groupSettings,
			// Normalize overlay back to Set/Map forms expected by `applyEvent`.
			messageOverlay: {
				deletedIds: new Set(checkpoint.messageOverlay?.deletedIds || []),
				editHistory: new Map(checkpoint.messageOverlay?.editHistory || []),
				reactionCounts: new Map(checkpoint.messageOverlay?.reactionCounts || []),
				pins: new Map(checkpoint.messageOverlay?.pins || []),
				fileIndex: new Map(checkpoint.messageOverlay?.fileIndex || []),
			},
			checkpoint_event_id: checkpoint.checkpoint_event_id,
			epoch_id: checkpoint.epoch_id,
			epoch_root_hash: checkpoint.epoch_root_hash,
			bannedMembers: new Set()
		}

		// 恢复成员
		if (checkpoint.members_page_0) {
			for (const member of checkpoint.members_page_0) {
				state.members[member.pubKeyHash] = member
			}
		}

		// 应用增量事件
		const events = await readEvents(groupId)
		const incrementalEvents = events.filter(e =>
			!checkpoint.checkpoint_event_id || e.timestamp > checkpoint.created_at
		)

		for (const event of incrementalEvents)
			state = applyEvent(state, event)

		this.groups.set(groupId, state)
		return state
	}

	/**
	 * 生成 PoW 挑战
	 * @param {string} groupId - 群组ID
	 * @returns {object}
	 */
	generatePowChallenge(groupId) {
		const state = this.groups.get(groupId)
		if (!state) {
			throw new Error('Group not found')
		}

		const challenge = generateChallenge(state.groupSettings.powDifficulty)
		this.challenges.set(challenge.challenge, {
			groupId,
			timestamp: challenge.timestamp
		})

		// 5分钟后清理
		setTimeout(() => {
			this.challenges.delete(challenge.challenge)
		}, 5 * 60 * 1000)

		return challenge
	}

	/**
	 * 同步群组
	 * @param {string} groupId - 群组ID
	 * @param {string} sinceEventId - 起始事件ID
	 * @returns {Promise<object>}
	 */
	async syncGroup(groupId, sinceEventId = null) {
		const checkpoint = await loadCheckpoint(groupId)
		const events = await readEvents(groupId)

		let incrementalEvents = events
		if (sinceEventId) {
			const sinceIndex = events.findIndex(e => e.id === sinceEventId)
			if (sinceIndex !== -1) {
				incrementalEvents = events.slice(sinceIndex + 1)
			}
		}

		return {
			checkpoint,
			events: incrementalEvents
		}
	}
}
