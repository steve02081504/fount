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

export async function addCharacter(charname) {
	const response = await fetch('/api/shells/chat/addchar', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatid: currentChatId, charname }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return response.json()
}

export async function removeCharacter(charname) {
	const response = await fetch('/api/shells/chat/removechar', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatid: currentChatId, charname }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return response.json()
}

export async function setWorld(worldname) {
	const response = await fetch('/api/shells/chat/setworld', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatid: currentChatId, worldname }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return response.json()
}

export async function setPersona(personaname) {
	const response = await fetch('/api/shells/chat/setpersona', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatid: currentChatId, personaname }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return response.json()
}

export async function triggerCharacterReply(charname) {
	const response = await fetch('/api/shells/chat/triggercharreply', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatid: currentChatId, charname }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return response.json()
}

export async function setCharReplyFrequency(charname, frequency) {
	const response = await fetch('/api/shells/chat/setcharreplyfrequency', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatid: currentChatId, charname, frequency }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return response.json()
}

export async function addUserReply(reply) {
	const response = await fetch('/api/shells/chat/adduserreply', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatid: currentChatId, reply }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return response.json()
}

export async function deleteMessage(index) {
	const response = await fetch('/api/shells/chat/deletemessage', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatid: currentChatId, index }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return response.json()
}

export async function editMessage(index, content) {
	const response = await fetch('/api/shells/chat/editmessage', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatid: currentChatId, index, content }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return response.json()
}

export async function getCharList() {
	const response = await fetch(`/api/shells/chat/getcharlist?${new URLSearchParams({
		chatid: currentChatId,
	})}`)

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return await response.json()
}

export async function getChatLog(start, end) {
	const response = await fetch(`/api/shells/chat/getchatlog?${new URLSearchParams({
		chatid: currentChatId,
		start,
		end
	})}`)

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return await response.json()
}

/**
 * @returns {Promise<{ charlist: string[], worldname: string, personaname: string, Messages: any[] }>}
 */
export async function triggerHeartbeat(start) {
	const response = await fetch(`/api/shells/chat/heartbeat?${new URLSearchParams({
		chatid: currentChatId,
		start
	})}`)

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return await response.json()
}

export async function getChatLogLength() {
	const response = await fetch(`/api/shells/chat/getchatloglength?${new URLSearchParams({
		chatid: currentChatId,
	})}`)

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return await response.json()
}

export async function getPersonaName() {
	const response = await fetch(`/api/shells/chat/getpersonaname?${new URLSearchParams({
		chatid: currentChatId,
	})}`)

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return await response.json()
}

export async function getWorldName() {
	const response = await fetch(`/api/shells/chat/getworldname?${new URLSearchParams({
		chatid: currentChatId,
	})}`)

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return await response.json()
}

export async function modifyTimeLine(delta) {
	const response = await fetch('/api/shells/chat/modifytimeline', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatid: currentChatId, delta }),
	})

	if (!response.ok)
		throw Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response })

	return await response.json()
}

if (window.location.hash)
	currentChatId = window.location.hash.substring(1)
