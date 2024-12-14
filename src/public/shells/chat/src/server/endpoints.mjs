import { authenticate, getUserByToken } from "../../../../../server/auth.mjs"
import {
	addchar,
	addUserReply,
	copyChat,
	deleteChat,
	exportChat,
	findEmptyChatid,
	getCharListOfChat,
	GetChatLog,
	getChatList,
	GetUserPersonaName,
	GetWorldName,
	newChat,
	newMetadata,
	modifyTimeLine,
	removechar,
	setPersona,
	setWorld,
	triggerCharReply,
	deleteMessage,
	editMessage,
	GetChatLogLength
} from './chat.mjs'
import { Buffer } from "node:buffer"

export function setEndpoints(app) {
	app.post('/api/shells/chat/new', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		res.status(200).json({ chatid: newChat(username) })
	})

	app.post('/api/shells/chat/addchar', async (req, res) => {
		res.status(200).json(await addchar(req.body.chatid, req.body.charname))
	})

	app.post('/api/shells/chat/removechar', async (req, res) => {
		await removechar(req.body.chatid, req.body.charname)
		res.status(200).json({ message: 'removechar ok' })
	})

	app.post('/api/shells/chat/setworld', async (req, res) => {
		await setWorld(req.body.chatid, req.body.worldname)
		res.status(200).json({ message: 'setworld ok' })
	})

	app.post('/api/shells/chat/setpersona', async (req, res) => {
		await setPersona(req.body.chatid, req.body.personaname)
		res.status(200).json({ message: 'setpersona ok' })
	})

	app.post('/api/shells/chat/triggercharreply', async (req, res) => {
		res.status(200).json(await triggerCharReply(req.body.chatid, req.body.charname))
	})

	app.post('/api/shells/chat/adduserreply', authenticate, async (req, res) => {
		let reply = req.body.reply
		reply.files = reply?.files?.map((file) => ({
			...file,
			buffer: Buffer.from(file.buffer, 'base64')
		}))
		res.status(200).json(await addUserReply(req.body.chatid, req.body.reply))
	})

	app.post('/api/shells/chat/modifytimeline', authenticate, async (req, res) => {
		const { chatid, delta } = req.body
		const entry = await modifyTimeLine(chatid, delta)
		res.status(200).json(entry)
	})

	app.post('/api/shells/chat/deletemessage', async (req, res) => {
		const { chatid, index } = req.body
		await deleteMessage(chatid, index)
		res.status(200).json({ message: 'deletemessage ok' })
	})

	app.post('/api/shells/chat/editmessage', async (req, res) => {
		const { chatid, index, content } = req.body
		content.files = content?.files?.map((file) => ({
			...file,
			buffer: Buffer.from(file.buffer, 'base64')
		}))
		let entry = await editMessage(chatid, index, content)
		res.status(200).json(entry)
	})

	app.post('/api/shells/chat/getcharlist', authenticate, async (req, res) => {
		res.status(200).json(await getCharListOfChat(req.body.chatid))
	})

	app.post('/api/shells/chat/getchatlog', authenticate, async (req, res) => {
		const { chatid, start, end } = req.body
		res.status(200).json(await GetChatLog(chatid, start, end))
	})

	app.post('/api/shells/chat/getchatloglength', authenticate, async (req, res) => {
		const { chatid } = req.body
		res.status(200).json(await GetChatLogLength(chatid))
	})

	app.post('/api/shells/chat/getpersonaname', async (req, res) => {
		res.status(200).json(await GetUserPersonaName(req.body.chatid))
	})

	app.post('/api/shells/chat/getworldname', async (req, res) => {
		res.status(200).json(await GetWorldName(req.body.chatid))
	})
	app.post('/api/shells/chat/list', authenticate, async (req, res) => {
		res.status(200).json(await getChatList((await getUserByToken(req.cookies.accessToken)).username))
	})

	app.delete('/api/shells/chat/delete', authenticate, async (req, res) => {
		const result = await deleteChat(req.body.chatids, (await getUserByToken(req.cookies.accessToken)).username)
		res.status(200).json(result)
	})

	app.post('/api/shells/chat/copy', authenticate, async (req, res) => {
		const result = await copyChat(req.body.chatids, (await getUserByToken(req.cookies.accessToken)).username)
		res.status(200).json(result)
	})

	app.post('/api/shells/chat/export', authenticate, async (req, res) => {
		const result = await exportChat(req.body.chatids)
		res.status(200).json(result)
	})
}

export function unsetEndpoints(app) {
	if (!app) return
	app.post('/api/shells/chat/new', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/chat/addchar', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/chat/removechar', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/chat/setworld', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/chat/setpersona', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/chat/triggercharreply', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/chat/adduserreply', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/chat/modifytimeline', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/chat/deletemessage', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/chat/editmessage', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/chat/deletelogentry', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/chat/getcharlist', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/chat/getchatlog', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/chat/getpersonaname', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/chat/getworldname', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/chat/list', (req, res) => {
		res.status(404)
	})

	app.delete('/api/shells/chat/delete', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/chat/copy', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/chat/export', (req, res) => {
		res.status(404)
	})
}
