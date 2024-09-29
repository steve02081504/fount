import { addUserReply, triggerCharacterReply } from "./src/public/endpoints.mjs"

const chatMessages = document.querySelector('.chat-messages')
const messageInput = document.getElementById('message-input')
const sendButton = document.getElementById('send-button')

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
})
