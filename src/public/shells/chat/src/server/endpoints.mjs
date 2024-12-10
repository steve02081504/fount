// endpoint file (modify this file)
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
	loadMetaData,
	newChat,
	newMetadata,
	removechar,
	setPersona,
	setWorld,
	triggerCharReply
} from './chat.mjs'

export function setEndpoints(app) {
	app.post('/api/shells/chat/new', authenticate, async (req, res) => {
		const { username } = getUserByToken(req.cookies.token)
		res.status(200).json({ chatid: newChat(username) })
	})

	app.post('/api/shells/chat/addchar', async (req, res) => {
		res.status(200).json(await addchar(req.body.chatid, req.body.charname))
	})

	app.post('/api/shells/chat/removechar', async (req, res) => {
		removechar(req.body.chatid, req.body.charname)
		res.status(200).json({ message: 'removechar ok' })
	})

	app.post('/api/shells/chat/setworld', async (req, res) => {
		setWorld(req.body.chatid, req.body.worldname)
		res.status(200).json({ message: 'setworld ok' })
	})

	app.post('/api/shells/chat/setpersona', async (req, res) => {
		setPersona(req.body.chatid, req.body.personaname)
		res.status(200).json({ message: 'setpersona ok' })
	})

	app.post('/api/shells/chat/triggercharreply', async (req, res) => {
		res.status(200).json(await triggerCharReply(req.body.chatid, req.body.charname))
	})

	app.post('/api/shells/chat/adduserreply', authenticate, async (req, res) => {
		res.status(200).json(addUserReply(req.body.chatid, req.body.content))
	})

	app.post('/api/shells/chat/getcharlist', authenticate, async (req, res) => {
		res.status(200).json(getCharListOfChat(req.body.chatid))
	})

	app.post('/api/shells/chat/getchatlog', authenticate, async (req, res) => {
		res.status(200).json(GetChatLog(req.body.chatid))
	})

	app.post('/api/shells/chat/getpersonaname', async (req, res) => {
		res.status(200).json(GetUserPersonaName(req.body.chatid))
	})

	app.post('/api/shells/chat/getworldname', async (req, res) => {
		res.status(200).json(GetWorldName(req.body.chatid))
	})
	app.post('/api/shells/chat/list', authenticate, async (req, res) => {
		res.status(200).json(await getChatList(getUserByToken(req.cookies.token).username))
	})

	app.delete('/api/shells/chat/delete', authenticate, async (req, res) => {
		// req.body.chatids is already an array
		const result = await deleteChat(req.body.chatids, getUserByToken(req.cookies.token).username)
		res.status(200).json(result)
	})

	app.post('/api/shells/chat/copy', authenticate, async (req, res) => {
		// req.body.chatids is already an array
		const result = await copyChat(req.body.chatids, getUserByToken(req.cookies.token).username)
		res.status(200).json(result)
	})

	app.post('/api/shells/chat/export', authenticate, async (req, res) => {
		// req.body.chatids is already an array
		const result = await exportChat(req.body.chatids, getUserByToken(req.cookies.token).username)
		res.status(200).json(result)
	})
}

export function unsetEndpoints(app) {
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
