import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'
import { loadShellData, saveShellData } from '../../../../../server/setting_loader.mjs'

import {
	appendGroupEvent,
	broadcastGroupEvent,
	createGroupChannel,
	deleteGroupChannel,
	appendListItemUpdate,
	appendPinMessageEvent,
	appendUnpinMessageEvent,
	appendEncryptedMailboxBatch,
	appendOwnerHeartbeat,
	appendOwnerSuccessionBallot,
	appendFileUploadEvent,
	appendFileDeleteEvent,
	appendReactionEvent,
	getEffectivePermissions,
	getGroupState,
	getGroupStorage,
	getFileAesKey,
	storeFileAesKey,
	checkWsIpRateLimit,
	setPowChallengeForGroup,
	listChannelMessages,
	listUserGroups,
	listUserGroupsWithMeta,
	registerGroupSocket,
	syncGroupEvents,
	updateGroupChannel,
} from './groupChat.mjs'
import { newChat } from './chat.mjs'
import { groupDefaultString } from './group_i18n_defaults.mjs'

/**
 * @param {import('npm:websocket-express').Router} router
 */
export function setGroupEndpoints(router) {
	router.ws('/ws/parts/shells\\:chat/group/:groupId', authenticate, async (ws, req) => {
		const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
		if (!checkWsIpRateLimit(ip)) {
			ws.close(1008, 'rate limited')
			return
		}
		const { groupId } = req.params
		registerGroupSocket(groupId, ws)
	})

	router.get('/api/parts/shells\\:chat/groups/list', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groups = await listUserGroupsWithMeta(username)
		// 兼容旧接口：同时返回 groupIds（纯 id 数组）与 groups（含名称）
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
		const chatid = await newChat(username, { name: groupDefaultString('dmDmName') })
		res.status(200).json({ groupId: chatid, chatid })
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/state', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const s = await getGroupState(username, groupId)
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
		const { checkpoint } = await getGroupState(username, groupId)
		res.status(200).json(checkpoint || {})
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/events', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const r = await syncGroupEvents(username, groupId, req.query)
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
		const out = await appendGroupEvent(username, groupId, ev, sk)
		res.status(200).json({ event: out })
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/channels/:channelId/messages', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, channelId } = req.params
		const list = await listChannelMessages(username, groupId, channelId, req.query)
		res.status(200).json({ messages: list })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/channels', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const body = req.body || {}
		const ev = await createGroupChannel(username, groupId, {
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
		const ev = await updateGroupChannel(username, groupId, channelId, {
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
		const ev = await deleteGroupChannel(username, groupId, channelId)
		res.status(200).json({ event: ev })
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/channels/:channelId/permissions', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, channelId } = req.params
		const body = req.body || {}
		const roleId = body.roleId
		if (!roleId)
			return res.status(400).json({ error: 'roleId required' })
		const ev = await appendGroupEvent(username, groupId, {
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
			? await appendUnpinMessageEvent(username, groupId, channelId, String(targetEventId), req.body?.sender || 'local')
			: await appendPinMessageEvent(username, groupId, channelId, String(targetEventId), req.body?.sender || 'local')
		res.status(200).json({ event: ev })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/channels/:parentChannelId/threads', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, parentChannelId } = req.params
		const body = req.body || {}
		const ev = await createGroupChannel(username, groupId, {
			type: body.type || 'text',
			name: body.name || groupDefaultString('threadName'),
			parentChannelId,
			syncScope: body.syncScope || 'channel',
			sender: body.sender || 'local',
		})
		res.status(200).json({ event: ev, channelId: ev.content?.channelId })
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/pow-challenge', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const { state } = await getGroupState(username, groupId)
		const difficulty = Number(state.groupSettings?.powDifficulty) || 0
		const challenge = randomUUID().replace(/-/gu, '')
		setPowChallengeForGroup(username, groupId, challenge)
		res.status(200).json({ challenge, difficulty, groupId })
	})

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

	// --- reaction_add / reaction_remove ---
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

	// --- 群设置更新（含 autoReplyFrequency）---
	router.put('/api/parts/shells\\:chat/groups/:groupId/settings', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const body = req.body || {}
		const ev = await appendGroupEvent(username, groupId, {
			type: 'group_settings_update',
			sender: body.sender || 'local',
			timestamp: Date.now(),
			content: body.settings || {},
		})
		res.status(200).json({ event: ev })
	})

	// --- 文件 aesKey 安全存储（home 节点认证信道）---
	router.put('/api/parts/shells\\:chat/groups/:groupId/files/:fileId/aes-key', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, fileId } = req.params
		const { aesKeyHex } = req.body || {}
		if (!aesKeyHex || typeof aesKeyHex !== 'string' || !/^[0-9a-fA-F]{64}$/u.test(aesKeyHex))
			return res.status(400).json({ error: 'aesKeyHex must be 64 hex chars (256-bit)' })
		await storeFileAesKey(username, groupId, decodeURIComponent(fileId), aesKeyHex)
		res.status(200).json({ ok: true })
	})

	// --- 文件 chunk 上传（经存储插件）---
	router.post('/api/parts/shells\\:chat/groups/:groupId/chunks', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const body = req.body || {}
		const { chunkHash, data } = body
		if (!chunkHash || !data)
			return res.status(400).json({ error: 'chunkHash and data (base64) required' })
		const plugin = getGroupStorage(username)
		const buf = new Uint8Array(Buffer.from(String(data), 'base64'))
		const result = await plugin.putChunk(groupId, String(chunkHash), buf)
		res.status(200).json({ storageLocator: result.storageLocator })
	})

	// --- 文件 chunk 下载（按 storageLocator）---
	router.get('/api/parts/shells\\:chat/groups/:groupId/chunks', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const locator = String(req.query.locator || '')
		if (!locator)
			return res.status(400).json({ error: 'locator query param required' })
		const plugin = getGroupStorage(username)
		const data = await plugin.getChunk(locator)
		res.status(200).json({ data: Buffer.from(data).toString('base64') })
	})

	// --- 文件完整下载（取 aesKey + manifest，客户端解密）---
	router.get('/api/parts/shells\\:chat/groups/:groupId/files/:fileId/meta', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, fileId } = req.params
		const { state } = await getGroupState(username, groupId)
		const meta = state.fileIndex.get(decodeURIComponent(fileId))
		if (!meta) return res.status(404).json({ error: 'file not found' })
		const aesKeyHex = await getFileAesKey(username, groupId, decodeURIComponent(fileId))
		res.status(200).json({ ...meta, aesKeyHex: aesKeyHex || null })
	})

	// --- DM 黑名单管理 ---
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

	router.post('/api/parts/shells\\:chat/groups/:groupId/broadcast', authenticate, async (req, res) => {
		const { groupId } = req.params
		broadcastGroupEvent(groupId, req.body?.payload || {})
		res.status(200).json({ ok: true })
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/permissions', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const { pubKeyHash, channelId } = req.query
		const perms = await getEffectivePermissions(username, groupId, String(pubKeyHash), String(channelId || 'default'))
		res.status(200).json(perms)
	})

	// --- 贴纸 / 表情（shellData，跨群可用）---
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

	/**
	 * 生成 QR 凭证迁移包（发送端调用）
	 * 返回当前用户的群组列表等身份信息，供浏览器侧加密后通过 Trystero 发送至接收端（GH Pages / 其他设备）
	 */
	router.get('/api/parts/shells\\:chat/qr-transfer/package', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groups = await listUserGroupsWithMeta(username)
		// 不传递私密凭证（签名密钥由接收端自行生成），仅传递可公开的群组元数据供对方快速接入
		res.status(200).json({
			displayName: username,
			groups: groups.map(g => ({ groupId: g.id, name: g.name })),
		})
	})
}
