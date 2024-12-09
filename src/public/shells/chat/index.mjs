import { renderTemplate } from "../../scripts/template.mjs"
import { addUserReply, getCharList, getChatLog, triggerCharacterReply } from "./src/public/endpoints.mjs"
import { renderMarkdown } from "./src/public/markdown.mjs"

const chatMessages = document.getElementById('chat-messages')
const messageInput = document.getElementById('message-input')
const sendButton = document.getElementById('send-button')

// 设置主题
function setTheme() {
	const prefersDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
	document.documentElement.setAttribute('data-theme', prefersDarkMode ? 'dark' : 'light')
}

async function updateChatMessages(messages) {
	chatMessages.innerHTML = '' // Clear existing messages

	for (const message of messages) await addMessage(message)
}

async function addMessage(message) {
	const messageElement = document.createElement('div')
	let renderedMessage = {
		...message,
		isSelf: message.isSelf,
		avatar: message.avatar || 'https://gravatar.com/avatar/0?d=mp&f=y',
		timeStamp: new Date(message.timeStamp).toLocaleString(),
		content: renderMarkdown(message.content)
	}
	messageElement.innerHTML = await renderTemplate('message_view', renderedMessage)
	chatMessages.appendChild(messageElement)
	// 消息添加后滚动到底部
	chatMessages.scrollTop = chatMessages.scrollHeight
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

async function initializeApp() {
	setTheme()
	await getChatLog().then(updateChatMessages)
	// 页面加载后将输入框聚焦
	messageInput.focus()
}
let charList = await getCharList()
initializeApp()
