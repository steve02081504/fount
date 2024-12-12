import { addUserReply, triggerCharacterReply } from '../endpoints.mjs'
import { appendMessage } from './messageList.mjs'
import { charList } from '../chat.mjs'
import { selectedFiles, clearSelectedFiles, attachmentPreviewContainer } from '../fileHandling.mjs'
import { addDragAndDropSupport } from './dragAndDrop.mjs'

const messageInputElement = document.getElementById('message-input')
const sendButtonElement = document.getElementById('send-button')

export function initializeMessageInput() {
	addDragAndDropSupport(messageInputElement)
	sendButtonElement.addEventListener('click', sendMessage)
	messageInputElement.addEventListener('keydown', handleKeyPress)
	messageInputElement.focus()
}

function handleKeyPress(event) {
	if (event.key === 'Enter' && (event.shiftKey || event.ctrlKey)) {
		event.preventDefault()
		sendMessage()
	}
}

async function sendMessage() {
	const messageText = messageInputElement.value.trim()
	if (!messageText && selectedFiles.length === 0) return

	messageInputElement.value = ''
	await appendMessage(await addUserReply({ content: messageText, files: selectedFiles }))
	clearSelectedFiles()
	attachmentPreviewContainer.innerHTML = ''
	await appendMessage(await triggerCharacterReply(charList[0]))
}
