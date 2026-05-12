import { Buffer } from 'node:buffer'

import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'
import { assignShellData, loadShellData } from '../../../../../server/setting_loader.mjs'

import { addDmBlock, loadDmBlocklist } from './chat/dm_blocklist.mjs'
import {
	handleGroupSocketIdentityMessage,
	handleGroupSocketRpcMessage,
} from './chat/websocket.mjs'
import {
	addchar,
	addUserReply,
	getCharListOfChat,
	getPluginListOfChat,
	GetChatLog,
	GetUserPersonaName,
	GetWorldName,
	handleClientWsControlFrame,
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
	registerChatUiSocket,
} from './chat.mjs'
import { addfile, getfile } from './files.mjs'

/**
 * 为聊天功能设置API端点。
 *
 * @param {import('npm:websocket-express').Router} router - Express路由实例，用于附加端点。
 */
export function setEndpoints(router) {
	router.get('/api/parts/shells\\:chat/dm-blocklist', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		res.status(200).json(loadDmBlocklist(username))
	})
	router.post('/api/parts/shells\\:chat/dm-blocklist', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const body = req.body && typeof req.body === 'object' ? req.body : {}
		const pubKeyHash = body.pubKeyHash
		const groupId = typeof body.groupId === 'string' ? body.groupId : undefined
		if (typeof pubKeyHash !== 'string' || !pubKeyHash.trim())
			return res.status(400).json({ success: false, error: 'pubKeyHash required' })
		addDmBlock(username, pubKeyHash, groupId)
		res.status(200).json(loadDmBlocklist(username))
	})

	/**
	 * 用户级书签（`shells/chat/bookmarks.json`，正文为 `{ entries: [...] }`）。
	 */
	router.get('/api/parts/shells\\:chat/bookmarks', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const raw = loadShellData(username, 'chat', 'bookmarks')
		if (Array.isArray(raw))
			assignShellData(username, 'chat', 'bookmarks', { entries: raw })
		const o = /** @type {{ entries?: unknown }} */ loadShellData(username, 'chat', 'bookmarks')
		const entries = Array.isArray(o.entries) ? o.entries : []
		res.status(200).json(entries)
	})
	router.put('/api/parts/shells\\:chat/bookmarks', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const body = req.body && typeof req.body === 'object' ? req.body : {}
		const entries = Array.isArray(body.entries) ? body.entries : []
		assignShellData(username, 'chat', 'bookmarks', { entries })
		res.status(200).json({ success: true })
	})

	/**
	 * 会话列表侧栏文件夹（`shells/chat/groupFolders.json`；§19 `groupFolders.json`）。
	 */
	router.get('/api/parts/shells\\:chat/group-folders', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const raw = loadShellData(username, 'chat', 'groupFolders')
		const folders = raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(/** @type {{ folders?: unknown }} */ raw.folders)
			? /** @type {{ folders: object[] }} */ raw.folders
			: []
		res.status(200).json({ folders })
	})
	router.put('/api/parts/shells\\:chat/group-folders', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const body = req.body && typeof req.body === 'object' ? req.body : {}
		const folders = Array.isArray(body.folders) ? body.folders : []
		assignShellData(username, 'chat', 'groupFolders', { folders })
		res.status(200).json({ success: true })
	})

	// 群会话 WS（Hub / 群壳 / RPC 共用；§21，已移除 `/ui/:groupId`）
	router.ws('/ws/parts/shells\\:chat/groups/:groupId', authenticate, async (ws, req) => {
		const { groupId } = req.params
		if (!groupId)
			return void ws.close()
		registerChatUiSocket(groupId, ws)
		ws.on('message', raw => {
			try {
				const msg = JSON.parse(String(raw))
				if (handleClientWsControlFrame(msg)) return
				if (handleGroupSocketIdentityMessage(ws, msg)) return
				void handleGroupSocketRpcMessage(groupId, ws, msg)
			}
			catch (e) {
				console.error('group ws message error', e)
			}
		})
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/initial-data', authenticate, async (req, res) => {
		const { groupId } = req.params
		res.status(200).json(await getInitialData(groupId))
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/chars', authenticate, async (req, res) => {
		const { groupId } = req.params
		res.status(200).json(await getCharListOfChat(groupId))
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/plugins', authenticate, async (req, res) => {
		const { groupId } = req.params
		res.status(200).json(await getPluginListOfChat(groupId))
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/log', authenticate, async (req, res) => {
		const { params: { groupId }, query: { start, end } } = req
		const { username } = await getUserByReq(req)
		const log = await GetChatLog(groupId, Number(start), Number(end))
		res.status(200).json(await Promise.all(log.map(entry => entry.toData(username))))
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/log/length', authenticate, async (req, res) => {
		const { groupId } = req.params
		res.status(200).json(await GetChatLogLength(groupId))
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/persona', authenticate, async (req, res) => {
		const { groupId } = req.params
		res.status(200).json(await GetUserPersonaName(groupId))
	})

	router.get('/api/parts/shells\\:chat/groups/:groupId/world', authenticate, async (req, res) => {
		const { groupId } = req.params
		res.status(200).json(await GetWorldName(groupId))
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/timeline', authenticate, async (req, res) => {
		const { params: { groupId }, body: { delta } } = req
		const entry = await modifyTimeLine(groupId, delta)
		res.status(200).json({ success: true, entry: await entry.toData((await getUserByReq(req)).username) })
	})

	router.delete('/api/parts/shells\\:chat/groups/:groupId/message/:index', authenticate, async (req, res) => {
		const { groupId, index } = req.params
		await deleteMessage(groupId, Number(index))
		res.status(200).json({ success: true })
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/message/:index', authenticate, async (req, res) => {
		const { params: { groupId, index }, body: { content } } = req
		content.files = content?.files?.map(file => ({
			...file,
			buffer: Buffer.from(file.buffer, 'base64')
		}))
		const entry = await editMessage(groupId, Number(index), content)
		res.status(200).json({ success: true, entry: await entry.toData((await getUserByReq(req)).username) })
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/message/:index/feedback', authenticate, async (req, res) => {
		const { params: { groupId, index }, body: feedback } = req
		const entry = await setMessageFeedback(groupId, Number(index), feedback)
		res.status(200).json({ success: true, entry: await entry.toData((await getUserByReq(req)).username) })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/message', authenticate, async (req, res) => {
		const { params: { groupId }, body: { reply } } = req
		reply.files = reply?.files?.map(file => ({
			...file,
			buffer: Buffer.from(file.buffer, 'base64')
		}))
		const entry = await addUserReply(groupId, reply)
		res.status(200).json({ success: true, entry: await entry.toData((await getUserByReq(req)).username) })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/trigger-reply', authenticate, async (req, res) => {
		const { params: { groupId }, body: { charname } } = req
		await triggerCharReply(groupId, charname)
		res.status(200).json({ success: true })
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/char/:charname/frequency', authenticate, async (req, res) => {
		const { params: { groupId, charname }, body: { frequency } } = req
		await setCharSpeakingFrequency(groupId, charname, frequency)
		res.status(200).json({ success: true })
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/world', authenticate, async (req, res) => {
		const { params: { groupId }, body: { worldname } } = req
		await setWorld(groupId, worldname)
		res.status(200).json({ success: true })
	})

	router.put('/api/parts/shells\\:chat/groups/:groupId/persona', authenticate, async (req, res) => {
		const { params: { groupId }, body: { personaname } } = req
		await setPersona(groupId, personaname)
		res.status(200).json({ success: true })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/char', authenticate, async (req, res) => {
		const { params: { groupId }, body: { charname } } = req
		await addchar(groupId, charname)
		res.status(200).json({ success: true })
	})

	router.delete('/api/parts/shells\\:chat/groups/:groupId/char/:charname', authenticate, async (req, res) => {
		const { groupId, charname } = req.params
		await removechar(groupId, charname)
		res.status(200).json({ success: true })
	})

	router.post('/api/parts/shells\\:chat/groups/:groupId/plugin', authenticate, async (req, res) => {
		const { params: { groupId }, body: { pluginname } } = req
		await addplugin(groupId, pluginname)
		res.status(200).json({ success: true })
	})

	router.delete('/api/parts/shells\\:chat/groups/:groupId/plugin/:pluginname', authenticate, async (req, res) => {
		const { groupId, pluginname } = req.params
		await removeplugin(groupId, pluginname)
		res.status(200).json({ success: true })
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
}
