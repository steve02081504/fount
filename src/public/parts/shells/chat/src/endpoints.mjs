import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'
import { loadShellData, saveShellData } from '../../../../../server/setting_loader.mjs'
import { geti18n } from '../../../../../scripts/i18n.mjs'

import {
	addchar,
	addUserReply,
	copyChat,
	deleteChat,
	exportChat,
	importChat,
	getCharListOfChat,
	getPluginListOfChat,
	GetChatLog,
	getChatList,
	GetUserPersonaName,
	GetWorldName,
	newChat,
	modifyTimeLine,
	removechar,
	addplugin,
	removeplugin,
	setPersona,
	setWorld,
	triggerCharReply,
	deleteMessage,
	editMessage,
	setMessageFeedback,
	GetChatLogLength,
	setCharSpeakingFrequency,
	getInitialData,
	registerChatUiSocket
} from './chat/session.mjs'
import { addfile, getfile } from './files.mjs'
import {
	appendEvent,
	broadcastEvent,
	createChannel,
	deleteChannel,
	appendListItemUpdate,
	appendPinEvent,
	appendUnpinEvent,
	appendEncryptedMailboxBatch,
	appendOwnerHeartbeat,
	appendOwnerSuccessionBallot,
	appendFileUploadEvent,
	appendFileDeleteEvent,
	appendReactionEvent,
	getEffectivePermissions,
	getState,
	listChannelMessages,
	listUserGroups,
	listUserGroupsWithMeta,
	syncEvents,
	updateChannel,
	rebuildAndSaveCheckpoint,
} from './chat/dag.mjs'
import {
	getBufferedChunk,
	registerSocket,
	checkWsRateLimit,
	setPowChallenge,
} from './chat/websocket.mjs'
import {
	getFileAesKey,
	storeFileAesKey,
	getStorage,
} from './chat/storage.mjs'

/**
 * 为聊天功能设置API端点。
 * @param {import('npm:websocket-express').Router} router
 */
export function setEndpoints(router) {
	// ─── 群组 WebSocket ──────────────────────────────────────────────────────

	router.ws('/ws/parts/shells\\:chat/group/:groupId', authenticate, async (ws, req) => {
		const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
		if (!checkWsRateLimit(ip)) {
			ws.close(1008, 'rate limited')
			return
		}
		const { groupId } = req.params
		registerSocket(groupId, ws)

		ws.on('message', raw => {
			let msg
			try { msg = JSON.parse(String(raw)) }
			catch { return }
			if (msg?.type === 'stream_chunk_nack') {
				const { pendingStreamId, missingSeq } = msg
				if (typeof pendingStreamId !== 'string' || typeof missingSeq !== 'number') return
				const text = getBufferedChunk(groupId, pendingStreamId, missingSeq)
				if (text !== null)
					try {
						ws.send(JSON.stringify({
							type: 'group_stream_chunk',
							channelId: msg.channelId,
							pendingStreamId,
							chunkSeq: missingSeq,
							text,
						}))
					}
					catch { /* ignore */ }
			}
		})
	})

	// ─── 聊天会话 WebSocket ──────────────────────────────────────────────────

	router.ws('/ws/parts/shells\\:chat/ui/:chatid', authenticate, async (ws, req) => {
		const { chatid } = req.params
		registerChatUiSocket(chatid, ws)
	})

	// ─── 群组列表 ────────────────────────────────────────────────────────────

	router.get('/api/parts/shells\\:chat/groups/list', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groups = await listUserGroupsWithMeta(username)
		res.status(200).json({ groupIds: groups.map(g => g.id), groups })
	})

	router.post('/api/parts/shells\\:chat/groups', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const body = req.body || {}
		const chatid = await newChat(username, { name: body.name || '聊天', defaultChannelName: body.defaultChannelName })
		res.status(200).json({ groupId: chatid, chatid })
	})

	router.post('/api/parts/shells\\:chat/groups/dm', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const chatid = await newChat(username, { name: geti18n('chat.group.defaults.dmDmName') })
		res.status(200).json({ groupId: chatid, chatid })
	})

	// ─── 群组状态 ────────────────────────────────────────────────────────────

	router.get('/api/parts/shells\\:chat/groups/:groupId/state', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const s = await getState(username, groupId)
		res.status(200).json({
			order: s.order,
			checkpoint: s.checkpoint,
			groupMeta: s.state.groupMeta,
			channels: Object.fromEntries(s.state.channels),
			privateMailboxEpochs: Object.fromEntries(s.state.privateMailboxEpochs ?? new Map()),
			ownerHeartbeats: Object.fromEntries(s.state.ownerHeartbeats ?? new Map()),
			fileIndex: Object.fromEntries(s.state.fileIndex ?? new Map()),
			delegatedOwnerPubKeyHash: s.state.delegatedOwnerPubKeyHash ?? null,
			members: [...s.state.members.entries()].map(([pubKeyHash, v]) => ({
				pubKeyHash,
				pubKeyHex: v.pubKeyHex,
				roles: v.roles || [],
			})),
		})
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/checkpoint', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const { checkpoint } = await getState(username, groupId)
		res.status(200).json(checkpoint || {})
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/members/page/:pageIndex', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, pageIndex } = req.params
		const idx = Math.max(0, Number(pageIndex) || 0)
		const PAGE_SIZE = 500
		const { state } = await getState(username, groupId)
		const allMembers = [...state.members.entries()]
		const page = allMembers.slice(idx * PAGE_SIZE, (idx + 1) * PAGE_SIZE)
		res.status(200).json({
			pageIndex: idx,
			pagesCount: Math.ceil(allMembers.length / PAGE_SIZE) || 1,
			members: page.map(([hash, v]) => ({
				pubKeyHash: hash,
				pubKeyHex: v.pubKeyHex,
				roles: v.roles || [],
			})),
		})
	})

	// ─── DAG 事件 ────────────────────────────────────────────────────────────

	router.get('/api/parts/shells\\:chat/groups/:groupId/events', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const r = await syncEvents(username, groupId, req.query)
		res.status(200).json(r)
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/events', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const body = req.body || {}
		let sk
		if (body.secretKeyHex)
			sk = new Uint8Array(Buffer.from(String(body.secretKeyHex), 'hex'))
		const ev = { ...body }
		delete ev.secretKeyHex
		const out = await appendEvent(username, groupId, ev, sk)
		res.status(200).json({ event: out })
	})

	// ─── 频道消息 ────────────────────────────────────────────────────────────

	router.get('/api/parts/shells\\:chat/groups/:groupId/channels/:channelId/messages', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, channelId } = req.params
		const list = await listChannelMessages(username, groupId, channelId, req.query)
		res.status(200).json({ messages: list })
	})

	// ─── 频道 CRUD ───────────────────────────────────────────────────────────

	router.post('/api/parts/shells\\:chat/groups/:groupId/channels', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const body = req.body || {}
		const ev = await createChannel(username, groupId, {
			channelId: body.channelId,
			type: body.type,
			name: body.name,
			desc: body.desc,
			parentChannelId: body.parentChannelId,
			syncScope: body.syncScope,
			isPrivate: body.isPrivate,
			subRoomId: body.subRoomId,
			manualItems: body.manualItems,
			sender: body.sender || 'local',
		})
		const cid = ev.content?.channelId || body.channelId
		res.status(200).json({ event: ev, channelId: cid })
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/channels/:channelId', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, channelId } = req.params
		const b = req.body || {}
		const ev = await updateChannel(username, groupId, channelId, {
			name: b.name,
			desc: b.desc,
			type: b.type,
			syncScope: b.syncScope,
			isPrivate: b.isPrivate,
			parentChannelId: b.parentChannelId,
			sender: b.sender || 'local',
		})
		res.status(200).json({ event: ev })
	})

	router.delete('/api/parts/shells\\:chat/groups/:groupId/channels/:channelId', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, channelId } = req.params
		const ev = await deleteChannel(username, groupId, channelId)
		res.status(200).json({ event: ev })
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/channels/:channelId/permissions', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, channelId } = req.params
		const body = req.body || {}
		const roleId = body.roleId
		if (!roleId)
			return res.status(400).json({ error: 'roleId required' })
		const ev = await appendEvent(username, groupId, {
			type: 'channel_permission_update',
			channelId,
			sender: body.sender || 'local',
			content: {
				channelId,
				roleId,
				allow: body.allow ?? null,
				deny: body.deny ?? null,
			},
		})
		res.status(200).json({ event: ev })
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/channels/:channelId/list-items', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, channelId } = req.params
		const items = req.body?.items
		if (!Array.isArray(items))
			return res.status(400).json({ error: 'items must be an array' })
		const ev = await appendListItemUpdate(username, groupId, channelId, items, req.body?.sender || 'local')
		res.status(200).json({ event: ev })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/channels/:channelId/pin', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, channelId } = req.params
		const targetEventId = req.body?.targetEventId
		if (!targetEventId)
			return res.status(400).json({ error: 'targetEventId required' })
		const ev = req.body?.unpin
			? await appendUnpinEvent(username, groupId, channelId, String(targetEventId), req.body?.sender || 'local')
			: await appendPinEvent(username, groupId, channelId, String(targetEventId), req.body?.sender || 'local')
		res.status(200).json({ event: ev })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/channels/:parentChannelId/threads', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, parentChannelId } = req.params
		const body = req.body || {}
		const ev = await createChannel(username, groupId, {
			type: body.type || 'text',
			name: body.name || geti18n('chat.group.defaults.threadName'),
			parentChannelId,
			syncScope: body.syncScope || 'channel',
			sender: body.sender || 'local',
		})
		res.status(200).json({ event: ev, channelId: ev.content?.channelId })
	})

	// ─── PoW ────────────────────────────────────────────────────────────────

	router.get('/api/parts/shells\\:chat/groups/:groupId/pow-challenge', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const { state } = await getState(username, groupId)
		const difficulty = Number(state.groupSettings?.powDifficulty) || 0
		const challenge = randomUUID().replace(/-/gu, '')
		setPowChallenge(username, groupId, challenge)
		res.status(200).json({ challenge, difficulty, groupId })
	})

	// ─── 私密频道 / 群主管理 ─────────────────────────────────────────────────

	router.post('/api/parts/shells\\:chat/groups/:groupId/mailbox-batch', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const body = req.body || {}
		const ev = await appendEncryptedMailboxBatch(username, groupId, body)
		res.status(200).json({ event: ev })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/owner-heartbeat', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const body = req.body || {}
		const ev = await appendOwnerHeartbeat(username, groupId, body)
		res.status(200).json({ event: ev })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/owner-succession-ballot', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const body = req.body || {}
		const ev = await appendOwnerSuccessionBallot(username, groupId, body)
		res.status(200).json({ event: ev })
	})

	// ─── 群文件 ──────────────────────────────────────────────────────────────

	router.post('/api/parts/shells\\:chat/groups/:groupId/files', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const ev = await appendFileUploadEvent(username, groupId, req.body || {})
		res.status(200).json({ event: ev })
	})

	router.delete('/api/parts/shells\\:chat/groups/:groupId/files/:fileId', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, fileId } = req.params
		const ev = await appendFileDeleteEvent(username, groupId, decodeURIComponent(fileId))
		res.status(200).json({ event: ev })
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/files/:fileId/aes-key', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, fileId } = req.params
		const { aesKeyHex } = req.body || {}
		if (!aesKeyHex || typeof aesKeyHex !== 'string' || !/^[0-9a-fA-F]{64}$/u.test(aesKeyHex))
			return res.status(400).json({ error: 'aesKeyHex must be 64 hex chars (256-bit)' })
		await storeFileAesKey(username, groupId, decodeURIComponent(fileId), aesKeyHex)
		res.status(200).json({ ok: true })
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/files/:fileId/meta', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, fileId } = req.params
		const { state } = await getState(username, groupId)
		const meta = state.fileIndex.get(decodeURIComponent(fileId))
		if (!meta) return res.status(404).json({ error: 'file not found' })
		const aesKeyHex = await getFileAesKey(username, groupId, decodeURIComponent(fileId))
		res.status(200).json({ ...meta, aesKeyHex: aesKeyHex || null })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/chunks', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const body = req.body || {}
		const { chunkHash, data } = body
		if (!chunkHash || !data)
			return res.status(400).json({ error: 'chunkHash and data (base64) required' })
		const plugin = getStorage(username)
		const buf = new Uint8Array(Buffer.from(String(data), 'base64'))
		const result = await plugin.putChunk(groupId, String(chunkHash), buf)
		res.status(200).json({ storageLocator: result.storageLocator })
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/chunks', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const locator = String(req.query.locator || '')
		if (!locator)
			return res.status(400).json({ error: 'locator query param required' })
		const plugin = getStorage(username)
		const data = await plugin.getChunk(locator)
		res.status(200).json({ data: Buffer.from(data).toString('base64') })
	})

	// ─── Reaction ────────────────────────────────────────────────────────────

	router.post('/api/parts/shells\\:chat/groups/:groupId/channels/:channelId/reactions', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, channelId } = req.params
		const body = req.body || {}
		const type = body.remove ? 'reaction_remove' : 'reaction_add'
		const ev = await appendReactionEvent(username, groupId, {
			type,
			channelId,
			targetEventId: String(body.targetEventId || ''),
			emoji: String(body.emoji || ''),
			sender: body.sender || 'local',
			targetPubKeyHash: body.targetPubKeyHash,
		})
		res.status(200).json({ event: ev })
	})

	// ─── 群设置 ──────────────────────────────────────────────────────────────

	router.put('/api/parts/shells\\:chat/groups/:groupId/settings', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const body = req.body || {}
		const ev = await appendEvent(username, groupId, {
			type: 'group_settings_update',
			sender: body.sender || 'local',
			timestamp: Date.now(),
			content: body.settings || {},
		})
		res.status(200).json({ event: ev })
	})

	// ─── WS 广播 ─────────────────────────────────────────────────────────────

	router.post('/api/parts/shells\\:chat/groups/:groupId/broadcast', authenticate, async (req, res) => {
		const { groupId } = req.params
		broadcastEvent(groupId, req.body?.payload || {})
		res.status(200).json({ ok: true })
	})

	// ─── 权限查询 ────────────────────────────────────────────────────────────

	router.get('/api/parts/shells\\:chat/groups/:groupId/permissions', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const { pubKeyHash, channelId } = req.query
		const perms = await getEffectivePermissions(username, groupId, String(pubKeyHash), String(channelId || 'default'))
		res.status(200).json(perms)
	})

	// ─── DM 黑名单 ───────────────────────────────────────────────────────────

	router.get('/api/parts/shells\\:chat/dm-blocklist', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const data = loadShellData(username, 'chat', 'dmBlocklist')
		res.status(200).json({ blocked: Array.isArray(data?.blocked) ? data.blocked : [] })
	})

	router.put('/api/parts/shells\\:chat/dm-blocklist', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const blocked = Array.isArray(req.body?.blocked) ? req.body.blocked : []
		saveShellData(username, 'chat', 'dmBlocklist', { blocked })
		res.status(200).json({ ok: true })
	})

	router.post('/api/parts/shells\\:chat/dm-blocklist', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { pubKeyHash, groupId } = req.body || {}
		const data = loadShellData(username, 'chat', 'dmBlocklist') || {}
		const blocked = Array.isArray(data.blocked) ? [...data.blocked] : []
		const entry = { pubKeyHash: pubKeyHash || null, groupId: groupId || null }
		if (!blocked.some(e => e.pubKeyHash === entry.pubKeyHash && e.groupId === entry.groupId))
			blocked.push(entry)
		saveShellData(username, 'chat', 'dmBlocklist', { blocked })
		res.status(200).json({ ok: true })
	})

	// ─── 贴纸 / 表情 ─────────────────────────────────────────────────────────

	router.get('/api/parts/shells\\:chat/stickers', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const data = loadShellData(username, 'chat', 'stickers')
		res.status(200).json(data?.items || [])
	})

	router.put('/api/parts/shells\\:chat/stickers', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const items = req.body?.items || []
		saveShellData(username, 'chat', 'stickers', { items })
		res.status(200).json({ ok: true })
	})

	router.get('/api/parts/shells\\:chat/emojis', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const data = loadShellData(username, 'chat', 'emojis')
		res.status(200).json(data?.items || [])
	})

	router.put('/api/parts/shells\\:chat/emojis', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const items = req.body?.items || []
		saveShellData(username, 'chat', 'emojis', { items })
		res.status(200).json({ ok: true })
	})

	router.get('/api/parts/shells\\:chat/role-templates', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const data = loadShellData(username, 'chat', 'roleTemplates')
		res.status(200).json(data?.templates || [])
	})

	router.put('/api/parts/shells\\:chat/role-templates', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const templates = req.body?.templates || []
		saveShellData(username, 'chat', 'roleTemplates', { templates })
		res.status(200).json({ ok: true })
	})

	router.get('/api/parts/shells\\:chat/bookmarks', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const data = loadShellData(username, 'chat', 'bookmarks')
		res.status(200).json(data?.entries || [])
	})

	router.put('/api/parts/shells\\:chat/bookmarks', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const entries = req.body?.entries || []
		saveShellData(username, 'chat', 'bookmarks', { entries })
		res.status(200).json({ ok: true })
	})

	router.get('/api/parts/shells\\:chat/groupFolders', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const data = loadShellData(username, 'chat', 'groupFolders')
		const folders = Array.isArray(data?.folders) ? data.folders : []
		res.status(200).json({ folders })
	})

	router.put('/api/parts/shells\\:chat/groupFolders', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		saveShellData(username, 'chat', 'groupFolders', req.body || { folders: [] })
		res.status(200).json({ ok: true })
	})

	// ─── QR 凭证迁移包 ───────────────────────────────────────────────────────

	router.get('/api/parts/shells\\:chat/qr-transfer/package', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groups = await listUserGroupsWithMeta(username)
		res.status(200).json({
			displayName: username,
			groups: groups.map(g => ({ groupId: g.id, name: g.name })),
		})
	})

	// ─── 聊天会话 REST API ───────────────────────────────────────────────────

	router.get('/api/parts/shells\\:chat/:chatid/initial-data', authenticate, async (req, res) => {
		const { chatid } = req.params
		res.status(200).json(await getInitialData(chatid))
	})

	router.get('/api/parts/shells\\:chat/:chatid/chars', authenticate, async (req, res) => {
		const { chatid } = req.params
		res.status(200).json(await getCharListOfChat(chatid))
	})

	router.get('/api/parts/shells\\:chat/:chatid/plugins', authenticate, async (req, res) => {
		const { chatid } = req.params
		res.status(200).json(await getPluginListOfChat(chatid))
	})

	router.get('/api/parts/shells\\:chat/:chatid/log', authenticate, async (req, res) => {
		const { params: { chatid }, query: { start, end } } = req
		const { username } = await getUserByReq(req)
		const log = await GetChatLog(chatid, Number(start), Number(end))
		res.status(200).json(await Promise.all(log.map(entry => entry.toData(username))))
	})

	router.get('/api/parts/shells\\:chat/:chatid/log/length', authenticate, async (req, res) => {
		const { chatid } = req.params
		res.status(200).json(await GetChatLogLength(chatid))
	})

	router.get('/api/parts/shells\\:chat/:chatid/persona', authenticate, async (req, res) => {
		const { chatid } = req.params
		res.status(200).json(await GetUserPersonaName(chatid))
	})

	router.get('/api/parts/shells\\:chat/:chatid/world', authenticate, async (req, res) => {
		const { chatid } = req.params
		res.status(200).json(await GetWorldName(chatid))
	})

	router.put('/api/parts/shells\\:chat/:chatid/timeline', authenticate, async (req, res) => {
		const { params: { chatid }, body: { delta } } = req
		const entry = await modifyTimeLine(chatid, delta)
		res.status(200).json({ success: true, entry: await entry.toData((await getUserByReq(req)).username) })
	})

	router.delete('/api/parts/shells\\:chat/:chatid/message/:index', authenticate, async (req, res) => {
		const { chatid, index } = req.params
		await deleteMessage(chatid, Number(index))
		res.status(200).json({ success: true })
	})

	router.put('/api/parts/shells\\:chat/:chatid/message/:index', authenticate, async (req, res) => {
		const { params: { chatid, index }, body: { content } } = req
		content.files = content?.files?.map(file => ({
			...file,
			buffer: Buffer.from(file.buffer, 'base64')
		}))
		const entry = await editMessage(chatid, Number(index), content)
		res.status(200).json({ success: true, entry: await entry.toData((await getUserByReq(req)).username) })
	})

	router.put('/api/parts/shells\\:chat/:chatid/message/:index/feedback', authenticate, async (req, res) => {
		const { params: { chatid, index }, body: feedback } = req
		const entry = await setMessageFeedback(chatid, Number(index), feedback)
		res.status(200).json({ success: true, entry: await entry.toData((await getUserByReq(req)).username) })
	})

	router.post('/api/parts/shells\\:chat/:chatid/message', authenticate, async (req, res) => {
		const { params: { chatid }, body: { reply } } = req
		reply.files = reply?.files?.map(file => ({
			...file,
			buffer: Buffer.from(file.buffer, 'base64')
		}))
		const entry = await addUserReply(chatid, reply)
		res.status(200).json({ success: true, entry: await entry.toData((await getUserByReq(req)).username) })
	})

	router.post('/api/parts/shells\\:chat/:chatid/trigger-reply', authenticate, async (req, res) => {
		const { params: { chatid }, body: { charname } } = req
		await triggerCharReply(chatid, charname)
		res.status(200).json({ success: true })
	})

	router.put('/api/parts/shells\\:chat/:chatid/char/:charname/frequency', authenticate, async (req, res) => {
		const { params: { chatid, charname }, body: { frequency } } = req
		await setCharSpeakingFrequency(chatid, charname, frequency)
		res.status(200).json({ success: true })
	})

	router.put('/api/parts/shells\\:chat/:chatid/world', authenticate, async (req, res) => {
		const { params: { chatid }, body: { worldname } } = req
		await setWorld(chatid, worldname)
		res.status(200).json({ success: true })
	})

	router.put('/api/parts/shells\\:chat/:chatid/persona', authenticate, async (req, res) => {
		const { params: { chatid }, body: { personaname } } = req
		await setPersona(chatid, personaname)
		res.status(200).json({ success: true })
	})

	router.post('/api/parts/shells\\:chat/:chatid/char', authenticate, async (req, res) => {
		const { params: { chatid }, body: { charname } } = req
		await addchar(chatid, charname)
		res.status(200).json({ success: true })
	})

	router.delete('/api/parts/shells\\:chat/:chatid/char/:charname', authenticate, async (req, res) => {
		const { chatid, charname } = req.params
		await removechar(chatid, charname)
		res.status(200).json({ success: true })
	})

	router.post('/api/parts/shells\\:chat/:chatid/plugin', authenticate, async (req, res) => {
		const { params: { chatid }, body: { pluginname } } = req
		await addplugin(chatid, pluginname)
		res.status(200).json({ success: true })
	})

	router.delete('/api/parts/shells\\:chat/:chatid/plugin/:pluginname', authenticate, async (req, res) => {
		const { chatid, pluginname } = req.params
		await removeplugin(chatid, pluginname)
		res.status(200).json({ success: true })
	})

	router.post('/api/parts/shells\\:chat/new', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		res.status(200).json({ chatid: await newChat(username) })
	})

	router.get('/api/parts/shells\\:chat/getchatlist', authenticate, async (req, res) => {
		res.status(200).json(await getChatList((await getUserByReq(req)).username))
	})

	router.delete('/api/parts/shells\\:chat/delete', authenticate, async (req, res) => {
		const result = await deleteChat(req.body.chatids, (await getUserByReq(req)).username)
		res.status(200).json(result)
	})

	router.post('/api/parts/shells\\:chat/copy', authenticate, async (req, res) => {
		const result = await copyChat(req.body.chatids, (await getUserByReq(req)).username)
		res.status(200).json(result)
	})

	router.post('/api/parts/shells\\:chat/export', authenticate, async (req, res) => {
		const result = await exportChat(req.body.chatids)
		res.status(200).json(result)
	})

	router.post('/api/parts/shells\\:chat/import', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const result = await importChat(req.body, username)
		res.status(result.success ? 200 : 400).json(result)
	})

	router.post('/api/parts/shells\\:chat/addfile', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const data = req.files
		for (const file of Object.values(data))
			await addfile(username, file.data)
		res.status(200).json({ message: 'files added' })
	})

	router.get('/api/parts/shells\\:chat/getfile', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { hash } = req.query
		const data = await getfile(username, hash)
		res.status(200).send(data)
	})

	router.get('/virtual_files/parts/shells\\:chat/:chatid', authenticate, async (req, res) => {
		const { chatid } = req.params
		const exportResult = await exportChat([chatid])
		if (!exportResult[0]?.success)
			return res.status(500).json({ message: exportResult[0]?.message || 'Failed to export chat' })

		const chatData = exportResult[0].data
		const filename = `chat-${chatid}.json`
		const fileContents = JSON.stringify(chatData, null, '\t')

		res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
		res.setHeader('Content-Type', 'application/json; charset=utf-8')
		res.send(fileContents)
	})
}
