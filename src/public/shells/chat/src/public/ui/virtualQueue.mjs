import { renderMessage } from './messageList.mjs'
import { getChatLog, getChatLogLength, triggerHeartbeat } from '../../public/endpoints.mjs'
import { modifyTimeLine } from '../endpoints.mjs'
import { TRANSITION_DURATION } from '../utils.mjs'
import { startHeartbeat, stopHeartbeat } from '../chat.mjs'

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

function messageIsEqual(a, b) {
	if (
		a.content != b.content ||
		a.timeStamp != b.timeStamp ||
		a.role != b.role
	) return false
	// 比较文件
	if (a.files.length != b.files.length) return false
	for (let i = 0; i < a.files.length; i++)
		for (const key of ['name', 'buffer', 'mimeType', 'description'])
			if (a.files[i][key] != b.files[i][key]) return false

	return true
}

export async function triggerVirtualQueueHeartbeat() {
	if (chatLogLength === null) return
	const data = await triggerHeartbeat(startIndex)
	const { Messages } = data // 自index开始的全部消息内容
	delete data.Messages

	if (Messages.length != queue.length) {
		const its_in_buttom = chatMessagesContainer.scrollTop == chatMessagesContainer.scrollHeight || // 本来就在底部
			chatMessagesContainer.scrollHeight - chatMessagesContainer.scrollTop - chatMessagesContainer.clientHeight <= 0 // 列表不够长，碰不到底部也算在底部

		queue = Messages
		await renderQueue()
		if (its_in_buttom) {
			chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight
			chatLogLength = startIndex + queue.length
			startIndex = Math.max(0, chatLogLength - BUFFER_SIZE)
			queue = queue.slice(-BUFFER_SIZE)
		}
		return data
	}

	// update queue
	for (let i = 0; i < queue.length; i++) {
		if (messageIsEqual(queue[i], Messages[i])) continue
		await replaceMessageInQueue(i, Messages[i])
	}

	return data
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
	const lastCharMessageIndex = queue.length - 1
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

		function removeArrows() {
			leftArrow.remove()
			rightArrow.remove()
		}

		leftArrow.addEventListener('click', async () => {
			removeArrows()
			const index = getQueueIndex(messageElement)
			if (index === -1) return
			await stopHeartbeat()
			await replaceMessageInQueue(index, await modifyTimeLine(-1))
			await startHeartbeat()
		})

		rightArrow.addEventListener('click', async () => {
			removeArrows()
			const index = getQueueIndex(messageElement)
			if (index === -1) return
			await stopHeartbeat()
			await replaceMessageInQueue(index, await modifyTimeLine(1))
			await startHeartbeat()
		})
	}
}

export async function appendMessageToQueue(message) {
	if (!message) return
	if (queue.length >= 2 * BUFFER_SIZE)
		startIndex += 1

	queue = queue.concat(message).slice(-2 * BUFFER_SIZE)
	chatLogLength++
	await renderQueue()
	chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight
}

export async function replaceMessageInQueue(index, message, element = null) {
	queue[index] = message

	const oldMessageElement = chatMessagesContainer.children[index]
	if (!oldMessageElement) throw new Error('Message not found in queue')

	element ??= await renderMessage(message)

	oldMessageElement.classList.add('smooth-transition')
	oldMessageElement.style.opacity = '0'

	await new Promise((resolve) => setTimeout(resolve, TRANSITION_DURATION))

	oldMessageElement.replaceWith(element)
	updateLastCharMessageArrows()
}

export function getQueueIndex(element) {
	const index = Array.from(chatMessagesContainer.children).indexOf(element)
	return index > queue.length || index < 0 ? -1 : index
}

export async function getMessageElementByIndex(index) {
	const messageIndex = await getMessageIndexByIndex(index)
	return chatMessagesContainer.children[messageIndex]
}

export async function getMessageElementByMessageIndex(messageIndex) {
	return chatMessagesContainer.children[messageIndex]
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
