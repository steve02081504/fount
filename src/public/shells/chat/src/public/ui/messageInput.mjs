import { addUserReply, triggerCharacterReply } from '../endpoints.mjs'
import { appendMessage } from './messageList.mjs'
import { charList } from '../chat.mjs'
import { addDragAndDropSupport } from './dragAndDrop.mjs'
import { handleFilesSelect } from "../fileHandling.mjs"

const messageInputElement = document.getElementById('message-input')
const sendButtonElement = document.getElementById('send-button')
const fileInputElement = document.getElementById('file-input')
const attachmentPreviewContainer = document.getElementById('attachment-preview')
const uploadButtonElement = document.getElementById('upload-button')

let SelectedFiles = []

export function initializeMessageInput() {
	uploadButtonElement.addEventListener('click', () => fileInputElement.click())
	fileInputElement.addEventListener('change', (event) => handleFilesSelect(event, SelectedFiles, attachmentPreviewContainer))
	addDragAndDropSupport(messageInputElement, SelectedFiles, attachmentPreviewContainer)
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
	if (!messageText && SelectedFiles.length === 0) return

	messageInputElement.value = ''
	await appendMessage(await addUserReply({ content: messageText, files: SelectedFiles }))
	SelectedFiles.length = 0
	attachmentPreviewContainer.innerHTML = ''
	await appendMessage(await triggerCharacterReply(charList[0]))
}
