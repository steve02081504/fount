import { renderTemplate } from "../../scripts/template.mjs"
import { addUserReply, getCharList, getChatLog, triggerCharacterReply } from "./src/public/endpoints.mjs"

const chatMessages = document.querySelector('.chat-messages')
const messageInput = document.getElementById('message-input')
const sendButton = document.getElementById('send-button')

function updateChatMessages(messages) {
	chatMessages.innerHTML = '' // Clear existing messages
	messages.forEach(addMessage)
}
async function addMessage(message) {
	const messageElement = document.createElement('div')
	messageElement.innerHTML = await renderTemplate('message_view', message)
	chatMessages.appendChild(messageElement)
}

async function sendMessage() {
	const message = messageInput.value
	if (message.trim() !== '') {
		addMessage(await addUserReply(message))
		messageInput.value = ''

		const reply = await triggerCharacterReply(charList[0])
		addMessage(reply)
	}
}

// --- Event listeners ---

sendButton.addEventListener('click', sendMessage)
messageInput.addEventListener('keydown', (event) => {
	if (event.key === 'Enter' && (event.shiftKey || event.ctrlKey)) {
		event.preventDefault() // Prevent default newline behavior
		sendMessage()
	}
})

getChatLog().then(updateChatMessages)
let charList = await getCharList()
