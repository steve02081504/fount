import { renderMessage } from './messageList.mjs'
import { getChatLog, getChatLogLength } from '../../public/endpoints.mjs'
import { modifyTimeLine } from '../endpoints.mjs'

const chatMessagesContainer = document.getElementById('chat-messages')
const BUFFER_SIZE = 20
const THRESHOLD = 10
let startIndex = 0
let queue = []
let chatLogLength = 0

export async function initializeVirtualQueue() {
	chatLogLength = await getChatLogLength()
	startIndex = Math.max(0, chatLogLength - BUFFER_SIZE)
	queue = await getChatLog(-BUFFER_SIZE)

	await renderQueue()
	chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight
	chatMessagesContainer.addEventListener('scroll', handleScroll)
}

async function renderQueue() {
	chatMessagesContainer.innerHTML = ''
	for (const message of queue) {
		const messageElement = await renderMessage(message)
		chatMessagesContainer.appendChild(messageElement)
	}
	updateLastCharMessageArrows()
}

async function handleScroll() {
	if (chatLogLength === null) return
	if (chatMessagesContainer.scrollTop < THRESHOLD && startIndex > 0)
		await prependMessages()
	else if (
		chatMessagesContainer.scrollHeight - chatMessagesContainer.scrollTop - chatMessagesContainer.clientHeight < THRESHOLD &&
		startIndex + queue.length < chatLogLength
	)
		await appendMessages()
}

async function prependMessages() {
	const firstVisibleElement = chatMessagesContainer.children[0]
	const firstVisibleElementRect = firstVisibleElement ? firstVisibleElement.getBoundingClientRect() : null
	const newStartIndex = Math.max(0, startIndex - BUFFER_SIZE)
	const newMessages = await getChatLog(newStartIndex, startIndex)
	startIndex = newStartIndex
	queue = newMessages.concat(queue).slice(-2 * BUFFER_SIZE)
	await renderQueue()

	if (firstVisibleElement && firstVisibleElementRect) {
		const newFirstVisibleElement = chatMessagesContainer.children[newMessages.length]
		if (newFirstVisibleElement) {
			const newFirstVisibleElementRect = newFirstVisibleElement.getBoundingClientRect()
			chatMessagesContainer.scrollTop += newFirstVisibleElementRect.top - firstVisibleElementRect.top
		}
	}
}

async function appendMessages() {
	const newMessages = await getChatLog(startIndex + queue.length, startIndex + queue.length + BUFFER_SIZE)
	queue = queue.concat(newMessages).slice(-2 * BUFFER_SIZE)
	await renderQueue()
}

function updateLastCharMessageArrows() {
	chatMessagesContainer.querySelectorAll('.arrow').forEach((arrow) => arrow.remove())
	let lastCharMessageIndex = queue.length - 1
	if (queue[lastCharMessageIndex]?.role == 'char') {
		const messageElement = chatMessagesContainer.children[lastCharMessageIndex]
		const messageContent = messageElement.querySelector('.content')

		const leftArrow = document.createElement('div')
		leftArrow.classList.add('arrow', 'left')
		leftArrow.textContent = '❮'
		messageContent.after(leftArrow)

		const rightArrow = document.createElement('div')
		rightArrow.classList.add('arrow', 'right')
		rightArrow.textContent = '❯'
		leftArrow.after(rightArrow)

		leftArrow.addEventListener('click', async () => {
			const index = getQueueIndex(messageElement)
			if (index === -1) return
			await replaceMessageInQueue(index, await modifyTimeLine(-1))
		})

		rightArrow.addEventListener('click', async () => {
			const index = getQueueIndex(messageElement)
			if (index === -1) return
			await replaceMessageInQueue(index, await modifyTimeLine(1))
		})
	}
}

export async function appendMessageToQueue(message) {
	if (queue.length >= 2 * BUFFER_SIZE)
		startIndex += 1

	queue = queue.concat(message).slice(-2 * BUFFER_SIZE)
	chatLogLength++
	await renderQueue()
	chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight
}

export async function replaceMessageInQueue(index, message) {
	queue[index] = message

	const oldMessageElement = chatMessagesContainer.children[index]
	if (!oldMessageElement) return

	const newMessageElement = await renderMessage(message)

	oldMessageElement.replaceWith(newMessageElement)
	updateLastCharMessageArrows()
}

export function getQueueIndex(element) {
	const index = Array.from(chatMessagesContainer.children).indexOf(element)
	return index > queue.length || index < 0 ? -1 : index
}

export async function getMessageIndexByIndex(index) {
	return startIndex + index
}

export async function deleteMessageInQueue(index) {
	if (index < 0 || index >= queue.length) return
	queue.splice(index, 1)
	chatLogLength--
	if (queue.length < BUFFER_SIZE)
		startIndex = Math.max(0, startIndex - (BUFFER_SIZE - queue.length))

	await renderQueue()
}
