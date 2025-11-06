import { Buffer } from 'node:buffer'

import { authenticate, getUserByReq } from '../../../../server/auth.mjs'

import {
	addchar,
	addUserReply,
	copyChat,
	deleteChat,
	exportChat,
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
	GetChatLogLength,
	setCharSpeakingFrequency,
	getInitialData,
	registerChatUiSocket
} from './chat.mjs'
import { addfile, getfile } from './files.mjs'

/**
 * 为聊天功能设置API端点。
 *
 * @param {import('npm:websocket-express').Router} router - Express路由实例，用于附加端点。
 */
export function setEndpoints(router) {
	router.ws('/ws/shells/chat/ui/:chatid', authenticate, async (ws, req) => {
		const { chatid } = req.params
		registerChatUiSocket(chatid, ws)
	})

	router.get('/api/shells/chat/:chatid/initial-data', authenticate, async (req, res) => {
		const { chatid } = req.params
		res.status(200).json(await getInitialData(chatid))
	})

	router.get('/api/shells/chat/:chatid/chars', authenticate, async (req, res) => {
		const { chatid } = req.params
		res.status(200).json(await getCharListOfChat(chatid))
	})

	router.get('/api/shells/chat/:chatid/plugins', authenticate, async (req, res) => {
		const { chatid } = req.params
		res.status(200).json(await getPluginListOfChat(chatid))
	})

	router.get('/api/shells/chat/:chatid/log', authenticate, async (req, res) => {
		const { params: { chatid }, query: { start, end } } = req
		const { username } = await getUserByReq(req)
		const log = await GetChatLog(chatid, parseInt(start, 10), parseInt(end, 10))
		res.status(200).json(await Promise.all(log.map(entry => entry.toData(username))))
	})

	router.get('/api/shells/chat/:chatid/log/length', authenticate, async (req, res) => {
		const { chatid } = req.params
		res.status(200).json(await GetChatLogLength(chatid))
	})

	router.get('/api/shells/chat/:chatid/persona', authenticate, async (req, res) => {
		const { chatid } = req.params
		res.status(200).json(await GetUserPersonaName(chatid))
	})

	router.get('/api/shells/chat/:chatid/world', authenticate, async (req, res) => {
		const { chatid } = req.params
		res.status(200).json(await GetWorldName(chatid))
	})

	router.put('/api/shells/chat/:chatid/timeline', authenticate, async (req, res) => {
		const { params: { chatid }, body: { delta } } = req
		const entry = await modifyTimeLine(chatid, delta)
		res.status(200).json({ success: true, entry: await entry.toData((await getUserByReq(req)).username) })
	})

	router.delete('/api/shells/chat/:chatid/message/:index', authenticate, async (req, res) => {
		const { chatid, index } = req.params
		await deleteMessage(chatid, parseInt(index, 10))
		res.status(200).json({ success: true })
	})

	router.put('/api/shells/chat/:chatid/message/:index', authenticate, async (req, res) => {
		const { params: { chatid, index }, body: { content } } = req
		content.files = content?.files?.map(file => ({
			...file,
			buffer: Buffer.from(file.buffer, 'base64')
		}))
		const entry = await editMessage(chatid, parseInt(index, 10), content)
		res.status(200).json({ success: true, entry: await entry.toData((await getUserByReq(req)).username) })
	})

	router.post('/api/shells/chat/:chatid/message', authenticate, async (req, res) => {
		const { params: { chatid }, body: { reply } } = req
		reply.files = reply?.files?.map(file => ({
			...file,
			buffer: Buffer.from(file.buffer, 'base64')
		}))
		const entry = await addUserReply(chatid, reply)
		res.status(200).json({ success: true, entry: await entry.toData((await getUserByReq(req)).username) })
	})

	router.post('/api/shells/chat/:chatid/trigger-reply', authenticate, async (req, res) => {
		const { params: { chatid }, body: { charname } } = req
		await triggerCharReply(chatid, charname)
		res.status(200).json({ success: true })
	})

	router.put('/api/shells/chat/:chatid/char/:charname/frequency', authenticate, async (req, res) => {
		const { params: { chatid, charname }, body: { frequency } } = req
		await setCharSpeakingFrequency(chatid, charname, frequency)
		res.status(200).json({ success: true })
	})

	router.put('/api/shells/chat/:chatid/world', authenticate, async (req, res) => {
		const { params: { chatid }, body: { worldname } } = req
		await setWorld(chatid, worldname)
		res.status(200).json({ success: true })
	})

	router.put('/api/shells/chat/:chatid/persona', authenticate, async (req, res) => {
		const { params: { chatid }, body: { personaname } } = req
		await setPersona(chatid, personaname)
		res.status(200).json({ success: true })
	})

	router.post('/api/shells/chat/:chatid/char', authenticate, async (req, res) => {
		const { params: { chatid }, body: { charname } } = req
		await addchar(chatid, charname)
		res.status(200).json({ success: true })
	})

	router.delete('/api/shells/chat/:chatid/char/:charname', authenticate, async (req, res) => {
		const { chatid, charname } = req.params
		await removechar(chatid, charname)
		res.status(200).json({ success: true })
	})

	router.post('/api/shells/chat/:chatid/plugin', authenticate, async (req, res) => {
		const { params: { chatid }, body: { pluginname } } = req
		await addplugin(chatid, pluginname)
		res.status(200).json({ success: true })
	})

	router.delete('/api/shells/chat/:chatid/plugin/:pluginname', authenticate, async (req, res) => {
		const { chatid, pluginname } = req.params
		await removeplugin(chatid, pluginname)
		res.status(200).json({ success: true })
	})

	router.post('/api/shells/chat/new', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		res.status(200).json({ chatid: await newChat(username) })
	})

	router.get('/api/shells/chat/getchatlist', authenticate, async (req, res) => {
		res.status(200).json(await getChatList((await getUserByReq(req)).username))
	})

	router.delete('/api/shells/chat/delete', authenticate, async (req, res) => {
		const result = await deleteChat(req.body.chatids, (await getUserByReq(req)).username)
		res.status(200).json(result)
	})

	router.post('/api/shells/chat/copy', authenticate, async (req, res) => {
		const result = await copyChat(req.body.chatids, (await getUserByReq(req)).username)
		res.status(200).json(result)
	})

	router.post('/api/shells/chat/export', authenticate, async (req, res) => {
		const result = await exportChat(req.body.chatids)
		res.status(200).json(result)
	})

	router.post('/api/shells/chat/addfile', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const data = req.files
		for (const file of Object.values(data))
			await addfile(username, file.data)
		res.status(200).json({ message: 'files added' })
	})

	router.get('/api/shells/chat/getfile', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { hash } = req.query
		const data = await getfile(username, hash)
		res.status(200).send(data)
	})
}
