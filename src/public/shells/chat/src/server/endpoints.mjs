import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'
import {
	addchar,
	addUserReply,
	copyChat,
	deleteChat,
	exportChat,
	getCharListOfChat,
	GetChatLog,
	getChatList,
	GetUserPersonaName,
	GetWorldName,
	newChat,
	modifyTimeLine,
	removechar,
	setPersona,
	setWorld,
	triggerCharReply,
	deleteMessage,
	editMessage,
	GetChatLogLength,
	setCharSpeakingFrequency,
	getHeartbeatData
} from './chat.mjs'
import { addfile, getfile } from './files.mjs'
import { Buffer } from 'node:buffer'

/**
 * Sets up the API endpoints for chat operations within the application.
 *
 * @param {import('npm:websocket-express').Router} router - The express router to which the endpoints will be attached.
 *
 * This function defines several POST and GET routes for managing chat functionalities, such as creating new chats,
 * adding or removing characters, setting world and persona, triggering character replies, modifying timelines, and
 * managing messages. Additionally, it provides endpoints for retrieving chat-related data like character lists, chat
 * logs, and persona/world names. File operations such as adding and retrieving files are also supported.
 *
 * Authentication is required for most endpoints to ensure secure access to chat data.
 */

export function setEndpoints(router) {
	router.post('/api/shells/chat/new', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		res.status(200).json({ chatid: await newChat(username) })
	})

	router.post('/api/shells/chat/addchar', async (req, res) => {
		res.status(200).json(await addchar(req.body.chatid, req.body.charname))
	})

	router.post('/api/shells/chat/removechar', async (req, res) => {
		await removechar(req.body.chatid, req.body.charname)
		res.status(200).json({ message: 'removechar ok' })
	})

	router.post('/api/shells/chat/setworld', async (req, res) => {
		res.status(200).json(await setWorld(req.body.chatid, req.body.worldname))
	})

	router.post('/api/shells/chat/setpersona', async (req, res) => {
		await setPersona(req.body.chatid, req.body.personaname)
		res.status(200).json({ message: 'setpersona ok' })
	})

	router.post('/api/shells/chat/triggercharreply', async (req, res) => {
		const { username } = await getUserByReq(req)
		res.status(200).json(await (await triggerCharReply(req.body.chatid, req.body.charname))?.toData?.(username))
	})

	router.post('/api/shells/chat/setcharreplyfrequency', authenticate, async (req, res) => {
		const { chatid, charname, frequency } = req.body
		await setCharSpeakingFrequency(chatid, charname, frequency)
		res.status(200).json({ message: 'setcharreplyfrequency ok' })
	})

	router.post('/api/shells/chat/adduserreply', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { reply } = req.body
		reply.files = reply?.files?.map((file) => ({
			...file,
			buffer: Buffer.from(file.buffer, 'base64')
		}))
		res.status(200).json(await (await addUserReply(req.body.chatid, req.body.reply)).toData(username))
	})

	router.post('/api/shells/chat/modifytimeline', authenticate, async (req, res) => {
		const { chatid, delta } = req.body
		const entry = await modifyTimeLine(chatid, delta)
		res.status(200).json(entry)
	})

	router.post('/api/shells/chat/deletemessage', async (req, res) => {
		const { chatid, index } = req.body
		await deleteMessage(chatid, index)
		res.status(200).json({ message: 'deletemessage ok' })
	})

	router.post('/api/shells/chat/editmessage', async (req, res) => {
		const { chatid, index, content } = req.body
		content.files = content?.files?.map((file) => ({
			...file,
			buffer: Buffer.from(file.buffer, 'base64')
		}))
		const entry = await editMessage(chatid, index, content)
		res.status(200).json(entry)
	})

	router.get('/api/shells/chat/getcharlist', authenticate, async (req, res) => {
		const { chatid } = req.query
		res.status(200).json(await getCharListOfChat(chatid))
	})

	router.get('/api/shells/chat/getchatlog', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { chatid, start, end } = req.query
		const startNum = parseInt(start, 10)
		const endNum = parseInt(end, 10)
		res.status(200).json(await GetChatLog(chatid, startNum, endNum).then((log) => Promise.all(log.map((entry) => entry.toData(username)))))
	})

	router.get('/api/shells/chat/heartbeat', authenticate, async (req, res) => {
		const { chatid, start } = req.query
		const startNum = parseInt(start, 10)
		res.status(200).json(await getHeartbeatData(chatid, startNum))
	})

	router.get('/api/shells/chat/getchatloglength', authenticate, async (req, res) => {
		const { chatid } = req.query
		res.status(200).json(await GetChatLogLength(chatid))
	})

	router.get('/api/shells/chat/getpersonaname', async (req, res) => {
		const { chatid } = req.query
		res.status(200).json(await GetUserPersonaName(chatid))
	})

	router.get('/api/shells/chat/getworldname', async (req, res) => {
		const { chatid } = req.query
		res.status(200).json(await GetWorldName(chatid))
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
