import fs from 'node:fs'
import path from 'node:path'

import { P2PGroupManager } from '../../../../../scripts/p2p/index.mjs'
import { createEvent } from '../../../../../scripts/p2p/dag.mjs'
import { applyEvent } from '../../../../../scripts/p2p/materialized_state.mjs'
import { appendEvent, readMessages, getLastEvent } from '../../../../../scripts/p2p/event_storage.mjs'
import { hasPermission, PERMISSIONS } from '../../../../../scripts/p2p/permissions.mjs'
import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'

let groupManager = null

function getNodeId() {
	try {
		if (typeof Deno !== 'undefined' && Deno?.env?.get)
			return Deno.env.get('NODE_ID') || crypto.randomUUID()
	} catch { }
	return crypto.randomUUID()
}

function getGroupManager() {
	if (!groupManager) {
		groupManager = new P2PGroupManager({
			nodeId: getNodeId(),
		})
	}
	return groupManager
}

function isActiveMember(state, username) {
	return state.members[username]?.status === 'active'
}

function canInChannel(state, member, permission, channelId) {
	return hasPermission(member, permission, state.roles, channelId, state.channelPermissions)
}

export function setGroupEndpoints(router) {
	const manager = getGroupManager()
	const registerRoute = (method, path, handler) => {
		router[method](path, authenticate, handler)
		router[method](new RegExp(`^${path.replaceAll('\\:', ':')}$`), authenticate, handler)
	}

	registerRoute('post', '/api/parts/shells\\:chat/group/new', async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const { name, description } = req.body

			const result = await manager.createGroup({
				creatorPubKeyHash: username,
				privateKey: new Uint8Array(32),
				name: name || 'New Group',
				description: description || '',
			})

			res.status(201).json({
				success: true,
				groupId: result.groupId,
				defaultChannelId: result.defaultChannelId,
			})
		} catch (error) {
			console.error('Create group error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	registerRoute('post', '/api/parts/shells\\:chat/group/dm', async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const { targetUsername } = req.body

			const result = await manager.createGroup({
				creatorPubKeyHash: username,
				privateKey: new Uint8Array(32),
				name: `DM: ${username} & ${targetUsername}`,
				description: 'Direct Message',
			})

			res.status(201).json({
				success: true,
				groupId: result.groupId,
				defaultChannelId: result.defaultChannelId,
			})
		} catch (error) {
			console.error('Create DM error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	registerRoute('get', '/api/parts/shells\\:chat/group/list', async (req, res) => {
		try {
			const { username } = await getUserByReq(req)

			const checkpointDir = path.join(process.cwd(), 'data', 'checkpoints')
			if (fs.existsSync(checkpointDir)) {
				for (const file of fs.readdirSync(checkpointDir)) {
					if (!file.endsWith('.json') || file.endsWith('_members.json'))
						continue
					const groupId = file.slice(0, -'.json'.length)
					if (manager.groups.has(groupId))
						continue
					try {
						await manager.getGroupState(groupId)
					} catch {
					}
				}
			}

			const groups = []
			for (const [groupId, state] of manager.groups.entries()) {
				if (state.members[username]?.status !== 'active')
					continue

				groups.push({
					groupId,
					name: state.groupMeta.name,
					desc: state.groupMeta.desc,
					avatar: state.groupMeta.avatar,
					defaultChannelId: state.groupSettings.defaultChannelId,
					memberCount: Object.values(state.members).filter(member => member.status === 'active').length,
					channelCount: Object.keys(state.channels || {}).length,
				})
			}

			res.status(200).json({ success: true, groups })
		} catch (error) {
			console.error('List groups error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.get(/^\/api\/parts\/shells:chat\/([^/]+)\/pow-challenge$/, authenticate, async (req, res) => {
		try {
			const groupId = req.params[0]
			const state = await manager.getGroupState(groupId)
			const difficulty = state.groupSettings?.powDifficulty || 4

			const challenge = {
				challenge: `${groupId}:${Date.now()}:${Math.random().toString(36).substr(2)}`,
				difficulty
			}
			res.status(200).json({ success: true, challenge })
		} catch (error) {
			console.error('PoW challenge error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.post(/^\/api\/parts\/shells:chat\/([^/]+)\/join$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const { inviteCode, pow } = req.body

			const result = await manager.joinGroup({
				groupId,
				pubKeyHash: username,
				privateKey: new Uint8Array(32),
				inviteCode,
				pow,
			})

			res.status(200).json(result)
		} catch (error) {
			console.error('Join group error:', error)
			res.status(400).json({ success: false, error: error.message })
		}
	})

	router.get(/^\/api\/parts\/shells:chat\/([^/]+)\/state$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const state = await manager.getGroupState(groupId)
			const member = state.members[username]
			const active = isActiveMember(state, username)

			let channels = state.channels
			let channelPermissions = state.channelPermissions || {}
			const groupSettings = { ...state.groupSettings }

			if (active) {
				channels = {}
				for (const [channelId, channel] of Object.entries(state.channels || {})) {
					const canView = canInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId)
					const canManage = canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId)
					if (canView || canManage)
						channels[channelId] = channel
				}

				channelPermissions = Object.fromEntries(
					Object.entries(state.channelPermissions || {}).filter(([channelId]) => channelId in channels)
				)

				if (groupSettings.defaultChannelId && !(groupSettings.defaultChannelId in channels)) {
					groupSettings.defaultChannelId = Object.keys(channels)[0] || null
				}
			}

			const activeMembers = Object.entries(state.members)
				.filter(([, m]) => m.status === 'active')
				.map(([key, m]) => ({
					username: m.pubKeyHash || key,
					pubKeyHash: m.pubKeyHash || key,
					roles: m.roles || ['@everyone'],
					joinedAt: m.joinedAt,
				}))

			const serializableState = {
				groupId: state.groupId,
				groupMeta: state.groupMeta,
				groupSettings,
				channels,
				roles: state.roles,
				channelPermissions,
				members: activeMembers,
				memberCount: activeMembers.length,
				isMember: active,
				myRoles: member?.roles || [],
			}
			res.status(200).json({ success: true, state: serializableState })
		} catch (error) {
			console.error('Get group state error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.get(/^\/api\/parts\/shells:chat\/([^/]+)\/checkpoint$/, authenticate, async (req, res) => {
		try {
			const { checkpoint } = await manager.syncGroup(req.params[0])
			res.status(200).json({ success: true, checkpoint })
		} catch (error) {
			console.error('Get checkpoint error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.get(/^\/api\/parts\/shells:chat\/([^/]+)\/events$/, authenticate, async (req, res) => {
		try {
			const { events } = await manager.syncGroup(req.params[0], req.query.since)
			res.status(200).json({ success: true, events })
		} catch (error) {
			console.error('Sync events error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.post(/^\/api\/parts\/shells:chat\/([^/]+)\/events$/, authenticate, async (req, res) => {
		try {
			const groupId = req.params[0]
			const events = Array.isArray(req.body) ? req.body : req.body?.events
			if (!Array.isArray(events))
				return res.status(400).json({ success: false, error: 'events array required' })

			let applied = 0
			for (const event of events) {
				if (event?.groupId && event.groupId !== groupId)
					continue
				const ok = await manager.handleIncomingEvent(event)
				if (ok)
					applied++
			}

			res.status(200).json({ success: true, applied })
		} catch (error) {
			console.error('Push events error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	// --- Group delete endpoint ---

	router.delete(/^\/api\/parts\/shells:chat\/([^/]+)$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const state = await manager.getGroupState(groupId)

			if (!state) {
				return res.status(404).json({ success: false, error: 'Group not found' })
			}

			const member = state.members[username]
			if (!member || member.status !== 'active') {
				return res.status(403).json({ success: false, error: 'Not a member' })
			}

			const isAdmin = (member.roles || []).includes('admin')
			if (!isAdmin) {
				return res.status(403).json({ success: false, error: 'Only admins can delete the group' })
			}

			manager.groups.delete(groupId)

			const checkpointDir = path.join(process.cwd(), 'data', 'checkpoints')
			const eventsDir = path.join(process.cwd(), 'data', 'events', groupId)
			const checkpointFile = path.join(checkpointDir, `${groupId}.json`)
			const membersFile = path.join(checkpointDir, `${groupId}_members.json`)

			try { if (fs.existsSync(checkpointFile)) fs.unlinkSync(checkpointFile) } catch { }
			try { if (fs.existsSync(membersFile)) fs.unlinkSync(membersFile) } catch { }
			try { if (fs.existsSync(eventsDir)) fs.rmSync(eventsDir, { recursive: true, force: true }) } catch { }

			res.status(200).json({ success: true })
		} catch (error) {
			console.error('Delete group error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	// --- Channel message endpoints (internal) ---

	router.get(/^\/api\/parts\/shells:chat\/([^/]+)\/channels\/([^/]+)\/messages$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]
			const { since, before, limit } = req.query

			const state = await manager.getGroupState(groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			const canView = canInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId)
			if (!canView)
				return res.status(403).json({ success: false, error: 'No permission to view channel' })

			const messages = await readMessages(groupId, channelId, {
				since: since || undefined,
				before: before || undefined,
				limit: limit ? Number(limit) : undefined
			})

			res.status(200).json({ success: true, messages })
		} catch (error) {
			console.error('Get channel messages error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	// --- Group meta & settings endpoints ---

	router.put(/^\/api\/parts\/shells:chat\/([^/]+)\/meta$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const { name, desc } = req.body

			const lastEvent = await getLastEvent(groupId)
			const event = await createEvent({
				type: 'group_meta_update',
				groupId,
				channelId: null,
				sender: username,
				content: { name, desc },
				prev_event_id: lastEvent?.id || null,
				privateKey: new Uint8Array(32),
				hlc: manager.hlc.tick()
			})

			await appendEvent(groupId, event)
			let nextState = await manager.getGroupState(groupId)
			nextState = applyEvent(nextState, event)
			manager.groups.set(groupId, nextState)

			res.status(200).json({ success: true })
		} catch (error) {
			console.error('Update group meta error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.put(/^\/api\/parts\/shells:chat\/([^/]+)\/settings$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]

			const lastEvent = await getLastEvent(groupId)
			const event = await createEvent({
				type: 'group_settings_update',
				groupId,
				channelId: null,
				sender: username,
				content: req.body,
				prev_event_id: lastEvent?.id || null,
				privateKey: new Uint8Array(32),
				hlc: manager.hlc.tick()
			})

			await appendEvent(groupId, event)
			let nextState = await manager.getGroupState(groupId)
			nextState = applyEvent(nextState, event)
			manager.groups.set(groupId, nextState)

			res.status(200).json({ success: true })
		} catch (error) {
			console.error('Update group settings error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	// --- Channel CRUD endpoints ---

	router.post(/^\/api\/parts\/shells:chat\/([^/]+)\/channels$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const { type, name, desc, isPrivate } = req.body
			const channelName = String(name || '').trim()
			if (!channelName)
				return res.status(400).json({ success: false, error: 'Channel name is required' })

			const state = await manager.getGroupState(groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })

			const canManageChannels = canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, state.groupSettings.defaultChannelId)
			if (!canManageChannels)
				return res.status(403).json({ success: false, error: 'No permission to manage channels' })

			const channelId = `channel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

			const lastEvent = await getLastEvent(groupId)
			const event = await createEvent({
				type: 'channel_create',
				groupId,
				channelId: null,
				sender: username,
				content: { channelId, type: type || 'text', name: channelName, desc: desc || '', isPrivate: isPrivate || false },
				prev_event_id: lastEvent?.id || null,
				privateKey: new Uint8Array(32),
				hlc: manager.hlc.tick()
			})

			await appendEvent(groupId, event)
			let nextState = await manager.getGroupState(groupId)
			nextState = applyEvent(nextState, event)
			manager.groups.set(groupId, nextState)

			res.status(201).json({ success: true, channelId })
		} catch (error) {
			console.error('Create channel error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.put(/^\/api\/parts\/shells:chat\/([^/]+)\/channels\/([^/]+)$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]
			const { name, desc, type, isPrivate, parentChannelId } = req.body

			const state = await manager.getGroupState(groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			const canManageChannels = canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId)
			if (!canManageChannels)
				return res.status(403).json({ success: false, error: 'No permission to manage channels' })

			const updates = {}
			if (name !== undefined) {
				const trimmed = String(name).trim()
				if (!trimmed)
					return res.status(400).json({ success: false, error: 'Channel name cannot be empty' })
				updates.name = trimmed
			}
			if (desc !== undefined)
				updates.desc = String(desc)
			if (type !== undefined)
				updates.type = type
			if (isPrivate !== undefined)
				updates.isPrivate = Boolean(isPrivate)
			if (parentChannelId !== undefined)
				updates.parentChannelId = parentChannelId || null

			if (Object.keys(updates).length === 0)
				return res.status(400).json({ success: false, error: 'No channel updates provided' })

			const lastEvent = await getLastEvent(groupId)
			const event = await createEvent({
				type: 'channel_update',
				groupId,
				channelId: null,
				sender: username,
				content: { channelId, updates },
				prev_event_id: lastEvent?.id || null,
				privateKey: new Uint8Array(32),
				hlc: manager.hlc.tick()
			})

			await appendEvent(groupId, event)
			let nextState = await manager.getGroupState(groupId)
			nextState = applyEvent(nextState, event)
			manager.groups.set(groupId, nextState)

			res.status(200).json({ success: true })
		} catch (error) {
			console.error('Update channel error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.delete(/^\/api\/parts\/shells:chat\/([^/]+)\/channels\/([^/]+)$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]

			const state = await manager.getGroupState(groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			const canManageChannels = canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId)
			if (!canManageChannels)
				return res.status(403).json({ success: false, error: 'No permission to manage channels' })
			if (state.groupSettings.defaultChannelId === channelId)
				return res.status(400).json({ success: false, error: 'Cannot delete default channel' })

			const lastEvent = await getLastEvent(groupId)
			const event = await createEvent({
				type: 'channel_delete',
				groupId,
				channelId: null,
				sender: username,
				content: { channelId },
				prev_event_id: lastEvent?.id || null,
				privateKey: new Uint8Array(32),
				hlc: manager.hlc.tick()
			})

			await appendEvent(groupId, event)
			let nextState = await manager.getGroupState(groupId)
			nextState = applyEvent(nextState, event)
			manager.groups.set(groupId, nextState)

			res.status(200).json({ success: true })
		} catch (error) {
			console.error('Delete channel error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	// --- Channel permission endpoints ---

	router.get(/^\/api\/parts\/shells:chat\/([^/]+)\/channels\/([^/]+)\/permissions$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]
			const state = await manager.getGroupState(groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			const canView = canInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId)
			const canManageChannels = canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId)
			if (!canView && !canManageChannels)
				return res.status(403).json({ success: false, error: 'No permission to view channel permissions' })

			const permissions = state.channelPermissions?.[channelId] || {}
			res.status(200).json({ success: true, permissions })
		} catch (error) {
			console.error('Get channel permissions error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.put(/^\/api\/parts\/shells:chat\/([^/]+)\/channels\/([^/]+)\/permissions$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]
			const { roleId, allow, deny } = req.body
			if (!roleId)
				return res.status(400).json({ success: false, error: 'roleId is required' })

			const state = await manager.getGroupState(groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })
			if (!state.roles[roleId])
				return res.status(404).json({ success: false, error: 'Role not found' })

			const canManageChannels = canInChannel(state, member, PERMISSIONS.MANAGE_CHANNELS, channelId)
			if (!canManageChannels)
				return res.status(403).json({ success: false, error: 'No permission to manage channels' })

			const lastEvent = await getLastEvent(groupId)
			const event = await createEvent({
				type: 'channel_permissions_update',
				groupId,
				channelId: null,
				sender: username,
				content: { channelId, roleId, allow: allow || {}, deny: deny || {} },
				prev_event_id: lastEvent?.id || null,
				privateKey: new Uint8Array(32),
				hlc: manager.hlc.tick()
			})

			await appendEvent(groupId, event)
			let nextState = await manager.getGroupState(groupId)
			nextState = applyEvent(nextState, event)
			manager.groups.set(groupId, nextState)

			res.status(200).json({ success: true })
		} catch (error) {
			console.error('Update channel permissions error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	// --- Role management endpoints ---

	router.post(/^\/api\/parts\/shells:chat\/([^/]+)\/roles$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const { name, color } = req.body

			const state = await manager.getGroupState(groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })

			const canManageRoles = hasPermission(member, PERMISSIONS.MANAGE_ROLES, state.roles, state.groupSettings.defaultChannelId, state.channelPermissions)
			if (!canManageRoles)
				return res.status(403).json({ success: false, error: 'No permission to manage roles' })

			const roleId = (name || 'role').trim().toLowerCase().replaceAll(/\s+/g, '_') + '_' + Date.now()
			const roleName = (name || '').trim()
			if (!roleName)
				return res.status(400).json({ success: false, error: 'Role name is required' })

			const lastEvent = await getLastEvent(groupId)
			const event = await createEvent({
				type: 'role_create',
				groupId,
				channelId: null,
				sender: username,
				content: {
					roleId,
					name: roleName,
					color: color || '#99AAB5',
					position: 10,
					permissions: { VIEW_CHANNEL: true },
					isDefault: false,
					isHoisted: false
				},
				prev_event_id: lastEvent?.id || null,
				privateKey: new Uint8Array(32),
				hlc: manager.hlc.tick()
			})

			await appendEvent(groupId, event)
			const newState = applyEvent(state, event)
			manager.groups.set(groupId, newState)

			res.status(201).json({ success: true, roleId })
		} catch (error) {
			console.error('Create role error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.delete(/^\/api\/parts\/shells:chat\/([^/]+)\/roles\/([^/]+)$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const roleId = decodeURIComponent(req.params[1])

			const state = await manager.getGroupState(groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })

			const canManageRoles = hasPermission(member, PERMISSIONS.MANAGE_ROLES, state.roles, state.groupSettings.defaultChannelId, state.channelPermissions)
			if (!canManageRoles)
				return res.status(403).json({ success: false, error: 'No permission to manage roles' })

			const role = state.roles[roleId]
			if (!role)
				return res.status(404).json({ success: false, error: 'Role not found' })
			if (role.isDefault)
				return res.status(400).json({ success: false, error: 'Default role cannot be deleted' })

			const lastEvent = await getLastEvent(groupId)
			const event = await createEvent({
				type: 'role_delete',
				groupId,
				channelId: null,
				sender: username,
				content: { roleId },
				prev_event_id: lastEvent?.id || null,
				privateKey: new Uint8Array(32),
				hlc: manager.hlc.tick()
			})

			await appendEvent(groupId, event)
			const newState = applyEvent(state, event)
			manager.groups.set(groupId, newState)

			res.status(200).json({ success: true })
		} catch (error) {
			console.error('Delete role error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.post(/^\/api\/parts\/shells:chat\/([^/]+)\/members\/([^/]+)\/(kick|ban)$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const targetUsername = decodeURIComponent(req.params[1])
			const action = req.params[2]

			const state = await manager.getGroupState(groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })

			const requiredPermission = action === 'ban' ? PERMISSIONS.BAN_MEMBERS : PERMISSIONS.KICK_MEMBERS
			const canModerate = hasPermission(member, requiredPermission, state.roles, state.groupSettings.defaultChannelId, state.channelPermissions)
			if (!canModerate)
				return res.status(403).json({ success: false, error: 'No permission to moderate members' })

			if (!state.members[targetUsername])
				return res.status(404).json({ success: false, error: 'Member not found' })
			if (targetUsername === username)
				return res.status(400).json({ success: false, error: 'Cannot moderate yourself' })

			const lastEvent = await getLastEvent(groupId)
			const event = await createEvent({
				type: action === 'ban' ? 'member_ban' : 'member_kick',
				groupId,
				channelId: null,
				sender: username,
				content: { targetPubKeyHash: targetUsername },
				prev_event_id: lastEvent?.id || null,
				privateKey: new Uint8Array(32),
				hlc: manager.hlc.tick()
			})

			await appendEvent(groupId, event)
			const newState = applyEvent(state, event)
			manager.groups.set(groupId, newState)

			res.status(200).json({ success: true })
		} catch (error) {
			console.error('Moderate member error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	router.put(/^\/api\/parts\/shells:chat\/([^/]+)\/roles\/([^/]+)\/permissions$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const roleId = decodeURIComponent(req.params[1])
			const { permission, enabled, permissions: bulkPermissions } = req.body

			const state = await manager.getGroupState(groupId)
			const role = state.roles[roleId]
			if (!role) return res.status(404).json({ success: false, error: 'Role not found' })

			let updatedPermissions
			if (permission === '__bulk__' && bulkPermissions) {
				updatedPermissions = bulkPermissions
			} else {
				updatedPermissions = { ...role.permissions }
				if (enabled) updatedPermissions[permission] = true
				else delete updatedPermissions[permission]
			}

			const lastEvent = await getLastEvent(groupId)
			const event = await createEvent({
				type: 'role_update',
				groupId,
				channelId: null,
				sender: username,
				content: { roleId, updates: { permissions: updatedPermissions } },
				prev_event_id: lastEvent?.id || null,
				privateKey: new Uint8Array(32),
				hlc: manager.hlc.tick()
			})

			await appendEvent(groupId, event)
			const newState = applyEvent(state, event)
			manager.groups.set(groupId, newState)

			res.status(200).json({ success: true })
		} catch (error) {
			console.error('Update role permission error:', error)
			res.status(500).json({ success: false, error: error.message })
		}
	})

	// --- Channel message endpoints ---

	router.post(/^\/api\/parts\/shells:chat\/([^/]+)\/channels\/([^/]+)\/messages$/, authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const groupId = req.params[0]
			const channelId = req.params[1]
			const { content } = req.body

			const state = await manager.getGroupState(groupId)
			const member = state.members[username]
			if (!member || member.status !== 'active')
				return res.status(403).json({ success: false, error: 'Not a member' })
			if (!state.channels[channelId])
				return res.status(404).json({ success: false, error: 'Channel not found' })

			const canView = canInChannel(state, member, PERMISSIONS.VIEW_CHANNEL, channelId)
			if (!canView)
				return res.status(403).json({ success: false, error: 'No permission to view channel' })

			const event = await manager.sendMessage({
				groupId,
				channelId,
				sender: username,
				privateKey: new Uint8Array(32),
				content: typeof content === 'string' ? { text: content } : content
			})

			res.status(201).json({ success: true, event })
		} catch (error) {
			console.error('Send channel message error:', error)
			res.status(400).json({ success: false, error: error.message })
		}
	})
}

export { getGroupManager }
