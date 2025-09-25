import { sendRequest } from './websocket.mjs'

export let currentChatId = null

export async function createNewChat() {
	const response = await fetch('/api/shells/chat/new', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
	})
	const data = await response.json()

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	currentChatId = data.chatid
	return data.chatid
}

export function addCharacter(charname) {
	return sendRequest('add_char', { charname })
}

export function removeCharacter(charname) {
	return sendRequest('remove_char', { charname })
}

export function setWorld(worldname) {
	return sendRequest('set_world', { worldname })
}

export function setPersona(personaname) {
	return sendRequest('set_persona', { personaname })
}

export function triggerCharacterReply(charname) {
	return sendRequest('trigger_char_reply', { charname })
}

export function setCharReplyFrequency(charname, frequency) {
	return sendRequest('set_char_reply_frequency', { charname, frequency })
}

export function addUserReply(reply) {
	return sendRequest('add_user_reply', { reply, callback: false })
}

export function deleteMessage(index) {
	return sendRequest('delete_message', { index })
}

export function editMessage(index, content) {
	return sendRequest('edit_message', { index, content })
}

export function getCharList() {
	return sendRequest('get_char_list')
}

export function getChatLog(start, end) {
	return sendRequest('get_chat_log', { start, end })
}

export function getChatLogLength() {
	return sendRequest('get_chat_log_length')
}

export function modifyTimeLine(delta) {
	return sendRequest('modify_timeline', { delta })
}

if (window.location.hash)
	currentChatId = window.location.hash.substring(1)
