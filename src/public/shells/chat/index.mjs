import { renderTemplate } from "../../scripts/template.mjs"
import { addUserReply, getCharList, getChatLog, triggerCharacterReply } from "./src/public/endpoints.mjs"
import { renderMarkdown } from "./src/public/markdown.mjs"

const chatMessages = document.querySelector('.chat-messages')
const messageInput = document.getElementById('message-input')
const sendButton = document.getElementById('send-button')

async function updateChatMessages(messages) {
	chatMessages.innerHTML = '' // Clear existing messages

	for (const message of messages) await addMessage(message)
}
async function addMessage(message) {
	const messageElement = document.createElement('div')
	let renderdMessage = {
		...message,
		avatar: message.avatar || 'https://gravatar.com/avatar/0?d=mp&f=y',
		timeStamp: new Date(message.timeStamp).toLocaleString(),
		content: renderMarkdown(message.content)
	}
	messageElement.innerHTML = await renderTemplate('message_view', renderdMessage)
	chatMessages.appendChild(messageElement)
}

async function sendMessage() {
	const message = messageInput.value
	if (message.trim() !== '') {
		await addMessage(await addUserReply(message))
		messageInput.value = ''

		const reply = await triggerCharacterReply(charList[0])
		await addMessage(reply)
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
