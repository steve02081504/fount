import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { geti18n } from '../../../../../scripts/i18n.mjs'
import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'
import { loadShellData, saveShellData } from '../../../../../server/setting_loader.mjs'

import {
	appendEvent,
	createChannel,
	deleteChannel,
	appendListItemUpdate,
	appendPinEvent,
	appendUnpinEvent,
	appendEncryptedMailboxBatch,
	appendOwnerHeartbeat,
	appendOwnerSuccessionBallot,
	appendHomeTransfer,
	appendChannelCryptoMigrate,
	appendFileUploadEvent,
	appendFileDeleteEvent,
	appendReactionEvent,
	getEffectivePermissions,
	getState,
	compactGroupCheckpoint,
	compactAndPruneChannelMessages,
	pruneChannelMessagesJsonl,
	requestMissingEventsGossip,
	listChannelMessages,
	listUserGroupsWithMeta,
	syncEvents,
	updateChannel,
} from './chat/dag.mjs'
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
	getInitialData,
	abortStreamByMessageId,
	onGroupWsClose,
	getChatTimelineCursor,
} from './chat/session.mjs'
import {
	getFileAesKey,
	storeFileAesKey,
	getStorage,
} from './chat/storage.mjs'
import {
	broadcastEvent,
	getBufferedChunk,
	registerSocket,
	checkWsRateLimit,
	setPowChallenge,
	handleGroupSocketIdentityMessage,
	handleGroupSocketRpcMessage,
} from './chat/websocket.mjs'
import { addfile, getfile } from './files.mjs'

/**
 * 为聊天功能设置API端点。
 *
 * @param {import('npm:websocket-express').Router} router 已挂载中间件后的 Express/WebSocket 路由器
 */
export function setEndpoints(router) {
	// ─── 统一群组 WebSocket ───────────────────────────────────────────────────
	// 同时处理 DAG 事件、AI 流式更新、打字状态、stop_generation

	router.ws('/ws/parts/shells\\:chat/groups/:groupId', authenticate, (ws, req) => {
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

			if (handleGroupSocketIdentityMessage(ws, msg)) return
			if (handleGroupSocketRpcMessage(groupId, ws, msg)) return

			switch (msg?.type) {
				case 'stream_chunk_nack': {
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
						catch (e) {
							if (ws.readyState === 1) throw e
						}
					break
				}
				case 'stop_generation':
					if (msg.payload?.messageId)
						abortStreamByMessageId(msg.payload.messageId)
					break
			}
		})

		ws.on('close', () => onGroupWsClose(groupId))
	})

	// ─── 列表 ────────────────────────────────────────────────────────────────

	router.get('/api/parts/shells\\:chat/list', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groups = await listUserGroupsWithMeta(username)
		res.status(200).json({ groupIds: groups.map(g => g.id), groups })
	})

	// ─── 新建聊天/群组（统一入口） ────────────────────────────────────────────

	router.post('/api/parts/shells\\:chat/new', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const body = req.body || {}
		const groupId = await newChat(username, {
			name: body.name,
			defaultChannelName: body.defaultChannelName,
			defaultChannelType: body.defaultChannelType,
		})
		res.status(200).json({ groupId })
	})

	router.post('/api/parts/shells\\:chat/dm', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groupId = await newChat(username, { name: geti18n('chat.group.defaults.dmDmName') })
		res.status(200).json({ groupId })
	})

	// ─── 群组公开信息（无需认证，供群发现/预览） ─────────────────────────────

	router.get('/api/parts/shells\\:chat/groups/:groupId/info', authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const { groupId } = req.params
			const { state } = await getState(username, groupId)
			res.status(200).json(state.groupSettings?.publicInfo || {})
		}
		catch { res.status(200).json({}) }
	})

	// ─── 群组 REST API ────────────────────────────────────────────────────────

	router.put('/api/parts/shells\\:chat/groups/:groupId/info', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const { bio, icon, background, tags } = req.body || {}
		const ev = await appendEvent(username, groupId, {
			type: 'group_settings_update',
			sender: 'local',
			timestamp: Date.now(),
			content: { publicInfo: { bio, icon, background, tags: Array.isArray(tags) ? tags : [] } },
		})
		res.status(200).json({ event: ev })
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/state', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const s = await getState(username, groupId)
		let viewerMemberPubKeyHash = null
		for (const [hash, v] of s.state.members.entries())
			if ((v.profile?.memberId ?? v.memberId) === username) {
				viewerMemberPubKeyHash = hash
				break
			}
		if (!viewerMemberPubKeyHash && s.state.members.size === 1)
			viewerMemberPubKeyHash = [...s.state.members.keys()][0]
		res.status(200).json({
			order: s.order,
			checkpoint: s.checkpoint,
			groupMeta: s.state.groupMeta,
			groupSettings: s.state.groupSettings,
			channels: Object.fromEntries(s.state.channels),
			privateMailboxEpochs: Object.fromEntries(s.state.privateMailboxEpochs ?? new Map()),
			ownerHeartbeats: Object.fromEntries(s.state.ownerHeartbeats ?? new Map()),
			fileIndex: Object.fromEntries(s.state.fileIndex ?? new Map()),
			delegatedOwnerPubKeyHash: s.state.delegatedOwnerPubKeyHash ?? null,
			viewerMemberPubKeyHash,
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

	router.post('/api/parts/shells\\:chat/groups/:groupId/compact', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const cp = await compactGroupCheckpoint(username, groupId)
		res.status(200).json({ ok: true, checkpoint: cp })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/history-query', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const out = await requestMissingEventsGossip(username, groupId, req.body || {})
		res.status(200).json(out)
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/channels/chat/:channelId/prune-messages', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, channelId } = req.params
		const keepLastN = Number(req.query.keepLastN) || 500
		const onlyMessages = req.query.onlyMessages === '1' || req.query.onlyMessages === 'true'
		if (onlyMessages)
			await pruneChannelMessagesJsonl(username, groupId, channelId, keepLastN)
		else
			await compactAndPruneChannelMessages(username, groupId, channelId, keepLastN)
		res.status(200).json({ ok: true, keepLastN, onlyMessages })
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
				profile: v.profile || null,
			})),
		})
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/members/:memberId', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, memberId } = req.params
		const { state } = await getState(username, groupId)
		const member = [...state.members.entries()].find(([, v]) =>
			(v.profile?.memberId ?? v.memberId) === memberId || v.pubKeyHash === memberId)
		if (!member) return res.status(404).json({ error: 'member not found' })
		const [hash, v] = member
		res.status(200).json({ pubKeyHash: hash, pubKeyHex: v.pubKeyHex, roles: v.roles || [], profile: v.profile || null })
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/members/me', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const { bio, status, background, links, avatar, contextLength } = req.body || {}
		const ev = await appendEvent(username, groupId, {
			type: 'member_profile_update',
			sender: 'local',
			timestamp: Date.now(),
			content: { bio, status, background, links, avatar, contextLength },
		})
		res.status(200).json({ event: ev })
	})

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

	router.put('/api/parts/shells\\:chat/groups/:groupId/default-channel', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const { channelId } = req.body || {}
		if (!channelId || typeof channelId !== 'string')
			return res.status(400).json({ error: 'channelId required' })
		const { state } = await getState(username, groupId)
		if (!state.channels.has(channelId))
			return res.status(404).json({ error: 'channel not found' })
		const ev = await appendEvent(username, groupId, {
			type: 'group_settings_update',
			sender: 'local',
			timestamp: Date.now(),
			content: { defaultChannelId: channelId },
		})
		res.status(200).json({ event: ev, defaultChannelId: channelId })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/broadcast', authenticate, (req, res) => {
		const { groupId } = req.params
		broadcastEvent(groupId, req.body?.payload || {})
		res.status(200).json({ ok: true })
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/permissions', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const { pubKeyHash, channelId } = req.query
		const perms = await getEffectivePermissions(username, groupId, String(pubKeyHash), String(channelId || 'default'))
		res.status(200).json(perms)
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/pow-challenge', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const { state } = await getState(username, groupId)
		const difficulty = Number(state.groupSettings?.powDifficulty) || 0
		const challenge = randomUUID().replace(/-/gu, '')
		setPowChallenge(username, groupId, challenge)
		res.status(200).json({ challenge, difficulty, groupId })
	})

	// ─── 群 AI 配置（群级，与频道无关） ──────────────────────────────────────

	router.get('/api/parts/shells\\:chat/groups/:groupId/initial-data', authenticate, async (req, res) => {
		const { groupId } = req.params
		res.status(200).json(await getInitialData(groupId))
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/chars', authenticate, async (req, res) => {
		const { groupId } = req.params
		res.status(200).json(await getCharListOfChat(groupId))
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/chars', authenticate, async (req, res) => {
		const { groupId } = req.params
		const { charname } = req.body || {}
		await addchar(groupId, charname)
		res.status(200).json({ success: true })
	})

	router.delete('/api/parts/shells\\:chat/groups/:groupId/chars/:charname', authenticate, async (req, res) => {
		const { groupId, charname } = req.params
		await removechar(groupId, charname)
		res.status(200).json({ success: true })
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/plugins', authenticate, async (req, res) => {
		const { groupId } = req.params
		res.status(200).json(await getPluginListOfChat(groupId))
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/plugins', authenticate, async (req, res) => {
		const { groupId } = req.params
		const { pluginname } = req.body || {}
		await addplugin(groupId, pluginname)
		res.status(200).json({ success: true })
	})

	router.delete('/api/parts/shells\\:chat/groups/:groupId/plugins/:pluginname', authenticate, async (req, res) => {
		const { groupId, pluginname } = req.params
		await removeplugin(groupId, pluginname)
		res.status(200).json({ success: true })
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/persona', authenticate, async (req, res) => {
		const { groupId } = req.params
		res.status(200).json(await GetUserPersonaName(groupId))
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/persona', authenticate, async (req, res) => {
		const { groupId } = req.params
		const { personaname } = req.body || {}
		await setPersona(groupId, personaname)
		res.status(200).json({ success: true })
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
		const locator = String(req.query.locator || '')
		if (!locator)
			return res.status(400).json({ error: 'locator query param required' })
		const plugin = getStorage(username)
		const data = await plugin.getChunk(locator)
		res.status(200).json({ data: Buffer.from(data).toString('base64') })
	})

	// ─── 群主管理 ─────────────────────────────────────────────────────────────

	router.post('/api/parts/shells\\:chat/groups/:groupId/mailbox-batch', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const body = req.body || {}
		const { channelId } = body
		if (!channelId)
			return res.status(400).json({ error: 'channelId required' })
		const { state } = await getState(username, groupId)
		const chMeta = state.channels.get(String(channelId))
		const scheme = chMeta?.encryptionScheme ?? 'none'
		const requiredVersion = typeof chMeta?.encryptionVersion === 'number' && Number.isFinite(chMeta.encryptionVersion)
			? Math.max(1, Math.floor(chMeta.encryptionVersion))
			: 1
		if (scheme !== 'mailbox-ecdh') {
			const unknownScheme = scheme !== 'none' && scheme !== 'mailbox-ecdh'
			return res.status(409).json({
				error: 'ENCRYPTION_SCHEME_MISMATCH',
				currentScheme: scheme,
				requiredVersion,
				...unknownScheme ? { messageKey: 'chat.group.unknownEncryptionScheme' } : {},
			})
		}
		const out = await appendEncryptedMailboxBatch(username, groupId, body)
		res.status(200).json({ event: out })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/owner-heartbeat', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const ev = await appendOwnerHeartbeat(username, groupId, req.body || {})
		res.status(200).json({ event: ev })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/owner-succession-ballot', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const ev = await appendOwnerSuccessionBallot(username, groupId, req.body || {})
		res.status(200).json({ event: ev })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/home-transfer', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId } = req.params
		const ev = await appendHomeTransfer(username, groupId, req.body || {})
		res.status(200).json({ event: ev })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/channels/:channelId/crypto-migrate', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, channelId } = req.params
		const { newScheme = 'aes-256-gcm', newVersion } = req.body || {}
		const ev = await appendChannelCryptoMigrate(username, groupId, {
			channelId,
			newScheme,
			newVersion,
			sender: 'local',
		})
		res.status(200).json({ event: ev })
	})

	// ─── 频道通用接口（所有类型共用） ────────────────────────────────────────

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

	router.put('/api/parts/shells\\:chat/groups/:groupId/channels/common/:channelId', authenticate, async (req, res) => {
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
			icon: b.icon,
			encryptionScheme: b.encryptionScheme,
			encryptionVersion: b.encryptionVersion,
			sender: b.sender || 'local',
		})
		res.status(200).json({ event: ev })
	})

	router.delete('/api/parts/shells\\:chat/groups/:groupId/channels/common/:channelId', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, channelId } = req.params
		const ev = await deleteChannel(username, groupId, channelId)
		res.status(200).json({ event: ev })
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/channels/common/:channelId/permissions', authenticate, async (req, res) => {
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

	router.post('/api/parts/shells\\:chat/groups/:groupId/channels/common/:channelId/pin', authenticate, async (req, res) => {
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

	// ─── chat 频道接口（AI对话、消息流，含文字和文件） ───────────────────────

	router.get('/api/parts/shells\\:chat/groups/:groupId/channels/chat/:channelId/messages', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, channelId } = req.params
		const list = await listChannelMessages(username, groupId, channelId, req.query)
		res.status(200).json({ messages: list })
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/channels/chat/:channelId/log', authenticate, async (req, res) => {
		const { params: { groupId, channelId }, query: { start, end } } = req
		const { username } = await getUserByReq(req)
		const log = await GetChatLog(groupId, channelId, Number(start), Number(end))
		res.status(200).json(await Promise.all(log.map(entry => entry.toData(username))))
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/channels/chat/:channelId/log/length', authenticate, async (req, res) => {
		const { groupId, channelId } = req.params
		res.status(200).json(await GetChatLogLength(groupId, channelId))
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/channels/chat/:channelId/message', authenticate, async (req, res) => {
		const { params: { groupId, channelId }, body: { reply } } = req
		reply.files = reply?.files?.map(file => ({
			...file,
			buffer: Buffer.from(file.buffer, 'base64')
		}))
		reply.extension = { ...reply.extension, groupChannelId: channelId }
		const entry = await addUserReply(groupId, channelId, reply)
		res.status(200).json({ success: true, entry: await entry.toData((await getUserByReq(req)).username) })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/channels/chat/:channelId/trigger-reply', authenticate, async (req, res) => {
		const { params: { groupId, channelId }, body: { charname } } = req
		await triggerCharReply(groupId, channelId, charname)
		res.status(200).json({ success: true })
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/channels/chat/:channelId/timeline', authenticate, async (req, res) => {
		const { groupId } = req.params
		const info = await getChatTimelineCursor(groupId)
		if (!info)
			return res.status(404).json({ error: 'chat not found' })
		res.status(200).json(info)
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/channels/chat/:channelId/timeline', authenticate, async (req, res) => {
		const { params: { groupId, channelId }, body: { delta } } = req
		const entry = await modifyTimeLine(groupId, channelId, delta)
		res.status(200).json({ success: true, entry: await entry.toData((await getUserByReq(req)).username) })
	})

	router.delete('/api/parts/shells\\:chat/groups/:groupId/channels/chat/:channelId/messages/:index', authenticate, async (req, res) => {
		const { groupId, channelId, index } = req.params
		await deleteMessage(groupId, channelId, Number(index))
		res.status(200).json({ success: true })
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/channels/chat/:channelId/messages/:index', authenticate, async (req, res) => {
		const { params: { groupId, channelId, index }, body: { content } } = req
		content.files = content?.files?.map(file => ({
			...file,
			buffer: Buffer.from(file.buffer, 'base64')
		}))
		const entry = await editMessage(groupId, channelId, Number(index), content)
		res.status(200).json({ success: true, entry: await entry.toData((await getUserByReq(req)).username) })
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/channels/chat/:channelId/messages/:index/feedback', authenticate, async (req, res) => {
		const { params: { groupId, channelId, index }, body: feedback } = req
		const entry = await setMessageFeedback(groupId, channelId, Number(index), feedback)
		res.status(200).json({ success: true, entry: await entry.toData((await getUserByReq(req)).username) })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/channels/chat/:channelId/reactions', authenticate, async (req, res) => {
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

	router.post('/api/parts/shells\\:chat/groups/:groupId/channels/chat/:channelId/threads', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, channelId: parentChannelId } = req.params
		const body = req.body || {}
		const ev = await createChannel(username, groupId, {
			type: body.type || 'chat',
			name: body.name || geti18n('chat.group.defaults.threadName'),
			parentChannelId,
			syncScope: body.syncScope || 'channel',
			sender: body.sender || 'local',
		})
		res.status(200).json({ event: ev, channelId: ev.content?.channelId })
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/channels/chat/:channelId/world', authenticate, async (req, res) => {
		const { groupId, channelId } = req.params
		res.status(200).json(await GetWorldName(groupId, channelId))
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/channels/chat/:channelId/world', authenticate, async (req, res) => {
		const { groupId, channelId } = req.params
		const { worldname } = req.body || {}
		await setWorld(groupId, channelId, worldname)
		res.status(200).json({ success: true })
	})

	// ─── list 频道接口（论坛/索引条目） ──────────────────────────────────────

	router.get('/api/parts/shells\\:chat/groups/:groupId/channels/list/:channelId/items', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, channelId } = req.params
		const { state } = await getState(username, groupId)
		const ch = state.channels.get(channelId)
		res.status(200).json({ items: ch?.manualItems || [] })
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/channels/list/:channelId/items', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { groupId, channelId } = req.params
		const items = req.body?.items
		if (!Array.isArray(items))
			return res.status(400).json({ error: 'items must be an array' })
		const ev = await appendListItemUpdate(username, groupId, channelId, items, req.body?.sender || 'local')
		res.status(200).json({ event: ev })
	})

	// ─── 用户级数据 ───────────────────────────────────────────────────────────

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

	router.get('/api/parts/shells\\:chat/qr-transfer/package', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const groups = await listUserGroupsWithMeta(username)
		res.status(200).json({
			displayName: username,
			groups: groups.map(g => ({ groupId: g.id, name: g.name })),
		})
	})

	// ─── 聊天管理（导入导出删除复制） ────────────────────────────────────────

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

	router.get('/virtual_files/parts/shells\\:chat/:groupId', authenticate, async (req, res) => {
		const { groupId } = req.params
		const exportResult = await exportChat([groupId])
		if (!exportResult[0]?.success)
			return res.status(500).json({ message: exportResult[0]?.message || 'Failed to export chat' })

		const chatData = exportResult[0].data
		const filename = `chat-${groupId}.json`
		const fileContents = JSON.stringify(chatData, null, '\t')

		res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
		res.setHeader('Content-Type', 'application/json; charset=utf-8')
		res.send(fileContents)
	})
}
