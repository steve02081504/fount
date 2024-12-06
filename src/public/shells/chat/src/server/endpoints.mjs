import { authenticate, getUserByToken } from "../../../../../server/auth.mjs"
import { addchar, addUserReply, findEmptyChatid, getCharListOfChat, GetChatLog, GetUserPersonaName, GetWorldName, loadMetaData, newChat, newMetadata, removechar, setPersona, setWorld, triggerCharReply } from './chat.mjs'

export function setEndpoints(app) {
	app.post('/api/shells/chat/new', authenticate ,async (req, res) => {
		const { username } = getUserByToken(req.cookies.token)
		let chatid = newChat(username)
		res.status(200).json({ chatid })
	})
	app.post('/api/shells/chat/addchar', async (req, res) => {
		const { chatid, charname } = req.body
		let result = await addchar(chatid, charname)
		res.status(200).json(result)
	})
	app.post('/api/shells/chat/removechar', async (req, res) => {
		const { chatid, charname } = req.body
		removechar(chatid, charname)
		res.status(200).json({ message: 'removechar ok' })
	})
	app.post('/api/shells/chat/setworld', async (req, res) => {
		const { chatid, worldname } = req.body
		setWorld(chatid, worldname)
		res.status(200).json({ message: 'setworld ok' })
	})
	app.post('/api/shells/chat/setpersona', async (req, res) => {
		const { chatid, personaname } = req.body
		setPersona(chatid, personaname)
		res.status(200).json({ message: 'setpersona ok' })
	})
	app.post('/api/shells/chat/triggercharreply', async (req, res) => {
		const { chatid, charname } = req.body
		const { locale } = getUserByToken(req.cookies.token)
		let result = await triggerCharReply(chatid, charname)
		res.status(200).json(result)
	})
	app.post('/api/shells/chat/adduserreply', authenticate, async (req, res) => {
		const { chatid, content } = req.body
		const { locale } = getUserByToken(req.cookies.token)
		let result = addUserReply(chatid, content, locale)
		res.status(200).json(result)
	})
	app.post('/api/shells/chat/getcharlist', authenticate, async (req, res) => {
		const { chatid } = req.body
		await loadMetaData(chatid, getUserByToken(req.cookies.token).username)
		let charlist = getCharListOfChat(chatid)
		res.status(200).json(charlist)
	})
	app.post('/api/shells/chat/getchatlog', authenticate, async (req, res) => {
		const { chatid } = req.body
		await loadMetaData(chatid, getUserByToken(req.cookies.token).username)
		let chatlog = GetChatLog(chatid)
		res.status(200).json(chatlog)
	})
	app.post('/api/shells/chat/getpersonaname', async (req, res) => {
		const { chatid } = req.body
		let personaname = GetUserPersonaName(chatid)
		res.status(200).json(personaname)
	})
	app.post('/api/shells/chat/getworldname', async (req, res) => {
		const { chatid } = req.body
		let worldname = GetWorldName(chatid)
		res.status(200).json(worldname)
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
}
