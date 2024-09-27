const chatMessages = document.querySelector('.chat-messages')
const messageInput = document.getElementById('message-input')
const sendButton = document.getElementById('send-button')

let currentChatId = null

// --- API functions ---

async function createNewChat() {
	const response = await fetch('/api/shells/chat/new', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
	})
	const data = await response.json()
	currentChatId = data.chatid
	return data.chatid
}

async function addCharacter(charname) {
	const response = await fetch('/api/shells/chat/addchar', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatid: currentChatId, charname }),
	})
	return response.json()
}

async function removeCharacter(charname) {
	const response = await fetch('/api/shells/chat/removechar', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatid: currentChatId, charname }),
	})
	return response.json()
}

async function setWorld(worldname) {
	const response = await fetch('/api/shells/chat/setworld', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatid: currentChatId, worldname }),
	})
	return response.json()
}

async function setPersona(personaname) {
	const response = await fetch('/api/shells/chat/setpersona', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatid: currentChatId, personaname }),
	})
	return response.json()
}

async function triggerCharacterReply(charname) {
	const response = await fetch('/api/shells/chat/triggercharreply', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatid: currentChatId, charname }),
	})
	return response.json()
}

async function addUserReply(content) {
	const response = await fetch('/api/shells/chat/adduserreply', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ chatid: currentChatId, content }),
	})
	return response.json()
}

// --- UI update functions ---

function updateChatMessages(messages) {
	chatMessages.innerHTML = '' // Clear existing messages

	messages.forEach(message => {
		const messageElement = document.createElement('div')
		messageElement.classList.add('message')
		messageElement.classList.add(message.sender === 'user' ? 'user-message' : 'char-message')
		messageElement.textContent = `${message.sender}: ${message.content}`
		chatMessages.appendChild(messageElement)
	})
}

// --- Event listeners ---

sendButton.addEventListener('click', async () => {
	const message = messageInput.value
	if (message.trim() !== '') {
		await addUserReply(message)
		messageInput.value = ''

		// Trigger character reply (assuming only one character for now)
		const reply = await triggerCharacterReply('CharacterName') // Replace with actual character name
		updateChatMessages([...reply.messages])
	}
});

// --- Initialization ---

(async () => {
	currentChatId = await createNewChat()
	// Add initial character, set world, persona, etc. here if needed
})()
