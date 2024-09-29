let currentChatId = null

export async function createNewChat() {
	const response = await fetch('/api/shells/chat/new', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
	})
	const data = await response.json()
	currentChatId = data.chatid
	window.history.replaceState(null, null, '/shells/chat/#' + data.chatid)
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
	return response.json()
}

export async function addUserReply(content) {
	const response = await fetch('/api/shells/chat/adduserreply', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatid: currentChatId, content }),
	})
	return response.json()
}

if (window.location.hash)
	currentChatId = window.location.hash.substring(1)
else
	createNewChat()
