import { hosturl } from '../../../server/server.mjs'
import {
	loadChat, addchar, newChat, setPersona, setWorld, getChatList, addUserReply, GetChatLog, GetChatLogLength,
	removechar, setCharSpeakingFrequency, getCharListOfChat, GetUserPersonaName, GetWorldName, modifyTimeLine,
	triggerCharReply, deleteMessage, editMessage
} from './src/server/chat.mjs'
import { setEndpoints } from './src/server/endpoints.mjs'
import { cleanFilesInterval } from './src/server/files.mjs'

let loading_count = 0

export default {
	info: {
		'': {
			name: 'chat',
			avatar: '',
			description: 'default description',
			description_markdown: 'default description',
			version: '1.0.0',
			author: 'steve02081504',
			home_page: '',
			tags: []
		}
	},
	Load: ({ router }) => {
		loading_count++
		setEndpoints(router)
	},
	Unload: () => {
		loading_count--
		if (loading_count === 0)
			clearInterval(cleanFilesInterval)
	},

	interfaces: {
		invokes: {
			ArgumentsHandler: async (user, args) => {
				const command = args[0]
				let chatId

				switch (command) {
					case 'start': {
						const charName = args[1]
						chatId = await newChat(user)
						console.log(`Started new chat at: ${hosturl}/shells/chat/#${chatId}`)
						if (charName) await addchar(chatId, charName)
						break
					}
					case 'asjson': {
						const chatInfo = JSON.parse(args[1])
						if (chatInfo.id)
							await loadChat(chatId = chatInfo.id, user)
						else
							chatId = await newChat(user)

						if (chatInfo.world)
							await setWorld(chatId, chatInfo.world)
						if (chatInfo.persona)
							await setPersona(chatId, chatInfo.persona)
						if (chatInfo.chars)
							for (const char of chatInfo.chars)
								await addchar(chatId, char)

						console.log(`Loaded chat from JSON: ${args[1]}`)
						break
					}
					case 'load': {
						chatId = args[1]
						if (!chatId) throw 'Chat ID is required for load command.'
						console.log(`Continue chat at: ${hosturl}/shells/chat/#${chatId}`)
						break
					}
					case 'list': {
						console.log(await getChatList(user))
						break
					}
					case 'send': {
						const chatId = args[1]
						const message = args[2]
						if (!chatId || !message) throw 'Chat ID and message are required for send command.'
						await addUserReply(chatId, { content: message })
						console.log(`Message sent to chat ${chatId}`)
						break
					}
					case 'tail': {
						const chatId = args[1]
						const n = parseInt(args[2] || '5', 10)
						if (!chatId) throw 'Chat ID is required for tail command.'
						const logLength = await GetChatLogLength(chatId)
						const logs = await GetChatLog(chatId, Math.max(0, logLength - n), logLength)
						logs.forEach(log => {
							console.log(`[${new Date(log.time_stamp).toLocaleString()}] ${log.name}: ${log.content}`)
						})
						break
					}
					case 'remove-char': {
						const [chatId, charName] = [args[1], args[2]]
						if (!chatId || !charName) throw 'Chat ID and character name are required.'
						await removechar(chatId, charName)
						console.log(`Character '${charName}' removed from chat ${chatId}`)
						break
					}
					case 'set-persona': {
						const [chatId, personaName] = [args[1], args[2]]
						if (!chatId) throw 'Chat ID is required.'
						await setPersona(chatId, personaName || null) // Allow removing persona
						console.log(`Persona for chat ${chatId} set to '${personaName || 'none'}'`)
						break
					}
					case 'set-world': {
						const [chatId, worldName] = [args[1], args[2]]
						if (!chatId) throw 'Chat ID is required.'
						await setWorld(chatId, worldName || null) // Allow removing world
						console.log(`World for chat ${chatId} set to '${worldName || 'none'}'`)
						break
					}
					case 'get-persona': {
						const chatId = args[1]
						if (!chatId) throw 'Chat ID is required.'
						console.log(await GetUserPersonaName(chatId))
						break
					}
					case 'get-world': {
						const chatId = args[1]
						if (!chatId) throw 'Chat ID is required.'
						console.log(await GetWorldName(chatId))
						break
					}
					case 'get-chars': {
						const chatId = args[1]
						if (!chatId) throw 'Chat ID is required.'
						console.log(await getCharListOfChat(chatId))
						break
					}
					case 'set-char-frequency': {
						const [chatId, charName, frequency] = [args[1], args[2], parseFloat(args[3])]
						if (!chatId || !charName || isNaN(frequency)) throw 'Chat ID, character name, and a valid frequency number are required.'
						await setCharSpeakingFrequency(chatId, charName, frequency)
						console.log(`Speaking frequency for '${charName}' in chat ${chatId} set to ${frequency}`)
						break
					}
					case 'trigger-reply': {
						const [chatId, charName] = [args[1], args[2]]
						if (!chatId) throw 'Chat ID is required.'
						await triggerCharReply(chatId, charName || null) // charName is optional
						console.log(`Triggered reply in chat ${chatId}` + (charName ? ` for character '${charName}'` : ''))
						break
					}
					case 'delete-message': {
						const [chatId, index] = [args[1], parseInt(args[2], 10)]
						if (!chatId || isNaN(index)) throw 'Chat ID and message index are required.'
						await deleteMessage(chatId, index)
						console.log(`Message at index ${index} in chat ${chatId} deleted.`)
						break
					}
					case 'edit-message': {
						const [chatId, index, ...contentParts] = [args[1], parseInt(args[2], 10), ...args.slice(3)]
						if (!chatId || isNaN(index) || contentParts.length === 0) throw 'Chat ID, message index, and new content are required.'
						const newContent = { content: contentParts.join(' ') } // Simple content object
						await editMessage(chatId, index, newContent)
						console.log(`Message at index ${index} in chat ${chatId} edited.`)
						break
					}
					case 'modify-timeline': {
						const [chatId, delta] = [args[1], parseInt(args[2], 10)]
						if (!chatId || isNaN(delta)) throw 'Chat ID and delta are required.'
						await modifyTimeLine(chatId, delta)
						console.log(`Timeline for chat ${chatId} modified by ${delta}.`)
						break
					}
					default:
						throw `Unknown command: ${command}. Available commands: start, asjson, load, list, send, tail, remove-char, set-persona, set-world, get-persona, get-world, get-chars, set-char-frequency, trigger-reply, delete-message, edit-message, modify-timeline`
				}
			},
			IPCInvokeHandler: async (user, data) => {
				const { command, charName, chatInfo, chatId, message, n, personaName, worldName, frequency, index, newContent, delta } = data
				switch (command) {
					case 'start': {
						const newChatId = await newChat(user)
						if (charName) await addchar(newChatId, charName)
						return newChatId
					}
					case 'asjson': {
						let newChatId
						if (chatInfo.id)
							await loadChat(newChatId = chatInfo.id, user)
						else
							newChatId = await newChat(user)

						if (chatInfo.world) await setWorld(newChatId, chatInfo.world)
						if (chatInfo.persona) await setPersona(newChatId, chatInfo.persona)
						if (chatInfo.chars)
							for (const char of chatInfo.chars)
								await addchar(newChatId, char)
						return newChatId
					}
					case 'load':
						if (!chatId) throw 'Chat ID is required for load command.'
						return chatId
					case 'list':
						return getChatList(user)
					case 'send':
						if (!chatId || !message) throw 'Chat ID and message are required for send command.'
						return addUserReply(chatId, message)
					case 'tail': {
						if (!chatId) throw 'Chat ID is required for tail command.'
						const logLength = await GetChatLogLength(chatId)
						return GetChatLog(chatId, Math.max(0, logLength - (n || 5)), logLength)
					}
					case 'remove-char':
						if (!chatId || !charName) throw 'Chat ID and character name are required.'
						return removechar(chatId, charName)
					case 'set-persona':
						if (!chatId) throw 'Chat ID is required.'
						return setPersona(chatId, personaName || null)
					case 'set-world':
						if (!chatId) throw 'Chat ID is required.'
						return setWorld(chatId, worldName || null)
					case 'get-persona':
						if (!chatId) throw 'Chat ID is required.'
						return GetUserPersonaName(chatId)
					case 'get-world':
						if (!chatId) throw 'Chat ID is required.'
						return GetWorldName(chatId)
					case 'get-chars':
						if (!chatId) throw 'Chat ID is required.'
						return getCharListOfChat(chatId)
					case 'set-char-frequency':
						if (!chatId || !charName || typeof frequency !== 'number') throw 'Chat ID, character name, and frequency are required.'
						return setCharSpeakingFrequency(chatId, charName, frequency)
					case 'trigger-reply':
						if (!chatId) throw 'Chat ID is required.'
						return triggerCharReply(chatId, charName || null)
					case 'delete-message':
						if (!chatId || typeof index !== 'number') throw 'Chat ID and message index are required.'
						return deleteMessage(chatId, index)
					case 'edit-message':
						if (!chatId || typeof index !== 'number' || !newContent) throw 'Chat ID, message index, and new content are required.'
						return editMessage(chatId, index, newContent)
					case 'modify-timeline':
						if (!chatId || typeof delta !== 'number') throw 'Chat ID and delta are required.'
						return modifyTimeLine(chatId, delta)
					default:
						throw `Unknown command: ${command}. Available commands: start, asjson, load, list, send, tail, remove-char, set-persona, set-world, get-persona, get-world, get-chars, set-char-frequency, trigger-reply, delete-message, edit-message, modify-timeline`
				}
			}
		}
	}
}
