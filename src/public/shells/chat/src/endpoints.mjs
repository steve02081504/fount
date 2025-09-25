import { Buffer } from 'node:buffer'

import { authenticate, getUserByReq } from '../../../../server/auth.mjs'

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
	getInitialData,
	registerChatUiSocket
} from './chat.mjs'
import { addfile, getfile } from './files.mjs'

/**
 * Sets up the API endpoints for chat operations within the application.
 *
 * @param {import('npm:websocket-express').Router} router - The express router to which the endpoints will be attached.
 */
export function setEndpoints(router) {
	router.ws('/ws/shells/chat/ui/:chatid', authenticate, async (ws, req) => {
		const { chatid } = req.params
		const { username } = await getUserByReq(req)
		registerChatUiSocket(chatid, ws)

		ws.on('message', async (msg) => {
			try {
				const { id, command, params } = JSON.parse(msg)

				const handle = async (action, params) => {
					const result = await action(params)
					ws.send(JSON.stringify({ type: 'response', id, payload: result }))
				}

				const handleWithChatId = (action, params) => handle(p => action(chatid, ...Object.values(p)), params)

				switch (command) {
					case 'get_initial_data':
						await handle(() => getInitialData(chatid))
						break
					case 'add_char':
						await handleWithChatId(addchar, params)
						break
					case 'remove_char':
						await handleWithChatId(removechar, params)
						break
					case 'set_world':
						await handleWithChatId(setWorld, params)
						break
					case 'set_persona':
						await handleWithChatId(setPersona, params)
						break
					case 'trigger_char_reply':
						await handleWithChatId(triggerCharReply, params)
						break
					case 'set_char_reply_frequency':
						await handleWithChatId(setCharSpeakingFrequency, params)
						break
					case 'add_user_reply': {
						const { reply, callback } = params
						reply.files = reply?.files?.map(file => ({
							...file,
							buffer: Buffer.from(file.buffer, 'base64')
						}))
						const entry = await addUserReply(chatid, reply)
						const payload = callback === false ? null : await entry.toData(username)
						ws.send(JSON.stringify({ type: 'response', id, payload }))
						break
					}
					case 'modify_timeline':
						await handleWithChatId(modifyTimeLine, params)
						break
					case 'delete_message':
						await handleWithChatId(deleteMessage, params)
						break
					case 'edit_message': {
						const { index, content } = params
						content.files = content?.files?.map(file => ({
							...file,
							buffer: Buffer.from(file.buffer, 'base64')
						}))
						const entry = await editMessage(chatid, index, content)
						ws.send(JSON.stringify({ type: 'response', id, payload: await entry.toData(username) }))
						break
					}
					case 'get_char_list':
						await handle(() => getCharListOfChat(chatid))
						break
					case 'get_chat_log':
						await handle(p => GetChatLog(chatid, ...Object.values(p)).then(log => Promise.all(log.map(entry => entry.toData(username)))), params)
						break
					case 'get_chat_log_length':
						await handle(() => GetChatLogLength(chatid))
						break
					case 'get_persona_name':
						await handle(() => GetUserPersonaName(chatid))
						break
					case 'get_world_name':
						await handle(() => GetWorldName(chatid))
						break
					default:
						ws.send(JSON.stringify({ type: 'response', id, error: `Unknown command: ${command}` }))
				}
			} catch (error) {
				console.error('Error processing WebSocket message:', error)
				import('https://esm.sh/@sentry/browser').then(Sentry => Sentry.captureException(error))
			}
		})
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
