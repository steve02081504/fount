import { getChatLog, getChatLogLength, triggerHeartbeat } from '../../src/endpoints.mjs'
import { startHeartbeat, stopHeartbeat } from '../chat.mjs'
import { modifyTimeLine } from '../endpoints.mjs'
import { TRANSITION_DURATION } from '../utils.mjs'

import { renderMessage, enableSwipe, disableSwipe } from './messageList.mjs'

const chatMessagesContainer = document.getElementById('chat-messages')
const BUFFER_SIZE = 20
let startIndex = 0
let queue = []
let chatLogLength = 0

let observer = null
let sentinelTop = null
let sentinelBottom = null
let isLoading = false
let currentSwipableElement = null

function createSentinel(id) {
	const sentinel = document.createElement('div')
	sentinel.id = id
	sentinel.style.height = '1px'
	sentinel.style.opacity = '0'
	sentinel.style.pointerEvents = 'none'
	return sentinel
}

async function handleIntersection(entries) {
	if (isLoading) return

	const entry = entries.find(e => e.isIntersecting)
	if (!entry) return

	try {
		isLoading = true
		if (entry.target.id === 'sentinel-top')
			if (startIndex > 0) {
				observer.unobserve(sentinelTop)
				await prependMessages()
			} else {
				isLoading = false
				observeSentinels() // 即使在顶部，也重新观察
			}
		else if (entry.target.id === 'sentinel-bottom') {
			const currentCount = startIndex + queue.length
			if (currentCount < chatLogLength) {
				observer.unobserve(sentinelBottom)
				await appendMessages()
			} else {
				isLoading = false
				observeSentinels() // 即使在底部，也重新观察
			}
		} else {
			isLoading = false
			console.warn(`[Intersection] 未知的哨兵目标: ${entry.target.id}`)
		}
	} catch (error) {
		console.error('[Intersection] 处理交叉事件出错:', error)
		isLoading = false
		observeSentinels() // 尝试恢复
	}
}

function initializeObserver() {
	if (observer) observer.disconnect()
	const options = {
		root: chatMessagesContainer,
		rootMargin: '200px 0px', // 预加载边距
		threshold: 0
	}
	observer = new IntersectionObserver(handleIntersection, options)
}

function observeSentinels() {
	sentinelTop = document.getElementById('sentinel-top')
	sentinelBottom = document.getElementById('sentinel-bottom')
	if (!observer) return

	// 关键: 总是先断开所有观察，再观察新的哨兵
	observer.disconnect()

	if (sentinelTop) observer.observe(sentinelTop)
	else console.warn('[Observe] 渲染后未找到 sentinel-top')

	if (sentinelBottom) observer.observe(sentinelBottom)
	else console.warn('[Observe] 渲染后未找到 sentinel-bottom')

	isLoading = false // 准备好处理新的交叉事件
}

export async function initializeVirtualQueue() {
	try {
		isLoading = true
		chatLogLength = await getChatLogLength()
		startIndex = Math.max(0, chatLogLength - BUFFER_SIZE)
		queue = await getChatLog(startIndex, chatLogLength)

		initializeObserver()
		await renderQueue() // 内部会调用 updateLastCharMessageArrows

		chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight
	} finally {
		observeSentinels() // 开始观察并重置 isLoading
	}
}

function messageIsEqual(a, b) {
	if (a.content != b.content || a.time_stamp != b.time_stamp || a.role != b.role) return false
	if ((a.files || []).length != (b.files || []).length) return false
	for (let i = 0; i < a.files.length; i++) {
		if (!a.files[i] || !b.files[i]) return false
		for (const key of ['name', 'buffer', 'mime_type', 'description'])
			if (a.files[i][key] != b.files[i][key]) return false
	}
	return true
}

export async function triggerVirtualQueueHeartbeat() {
	if (chatLogLength === null || !observer) return

	const data = await triggerHeartbeat(startIndex).catch(error => {
		if (error.error == 'Chat not found') {
			window.close()
			window.location = '/shells/home'
		}
		else if (error.response.status == 401)
			window.location = '/login?redirect=' + encodeURIComponent(window.location)
		console.error('[Heartbeat] Error when handling heartbeat:', error)
	})
	if (!data) return
	const { Messages } = data
	delete data.Messages

	if (!Messages || !Array.isArray(Messages)) {
		console.warn('[Heartbeat] Invalid heartbeat Messages:', Messages)
		return data
	}

	if (Messages.length !== queue.length) { // 数量变化
		const its_in_bottom = chatMessagesContainer.scrollTop >= chatMessagesContainer.scrollHeight - chatMessagesContainer.clientHeight - 5
		queue = Messages
		const newTotalLength = startIndex + queue.length
		// 更新总长度 (可能增减)
		if (newTotalLength !== chatLogLength)
			chatLogLength = newTotalLength

		await renderQueue() // 重绘
		observeSentinels() // 观察新哨兵
		if (its_in_bottom)
			chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight
	} else  // 内容变化检查
		for (let i = 0; i < queue.length; i++) {
			if (!Messages[i]) continue
			if (!messageIsEqual(queue[i], Messages[i]))
				await replaceMessageInQueue(i, Messages[i]) // 只替换变化的
		}
	return data
}


async function renderQueue() {
	const fragment = document.createDocumentFragment()

	sentinelTop = createSentinel('sentinel-top')
	fragment.appendChild(sentinelTop)

	const renderPromises = queue.map(message => renderMessage(message))
	const messageElements = await Promise.all(renderPromises)
	messageElements.forEach(element => {
		if (element) fragment.appendChild(element)
		else console.warn('[RenderQueue] renderMessage 返回了 null/undefined')
	})

	sentinelBottom = createSentinel('sentinel-bottom')
	fragment.appendChild(sentinelBottom)

	chatMessagesContainer.innerHTML = ''
	chatMessagesContainer.appendChild(fragment)

	updateLastCharMessageArrows() // 渲染后更新箭头和滑动状态

	// 调用者负责调用 observeSentinels()
}

async function prependMessages() {
	const firstMessageElement = chatMessagesContainer.querySelector('.chat-message:not([id^="sentinel"])')
	const oldScrollTop = chatMessagesContainer.scrollTop
	const oldFirstElementRect = firstMessageElement ? firstMessageElement.getBoundingClientRect() : null
	const itemsToFetch = BUFFER_SIZE
	const newStartIndex = Math.max(0, startIndex - itemsToFetch)
	const numItemsActuallyFetched = startIndex - newStartIndex

	if (numItemsActuallyFetched <= 0) {
		isLoading = false
		observeSentinels()
		return
	}

	try {
		const newMessages = await getChatLog(newStartIndex, startIndex)
		if (newMessages && newMessages.length > 0) {
			startIndex = newStartIndex
			queue = newMessages.concat(queue)
			queue = queue.slice(0, 3 * BUFFER_SIZE)

			await renderQueue() // 重绘

			// 恢复滚动位置
			const newFirstElementCorrespondingToOld = chatMessagesContainer.children[numItemsActuallyFetched + 1]
			if (newFirstElementCorrespondingToOld && oldFirstElementRect) {
				const newFirstElementRect = newFirstElementCorrespondingToOld.getBoundingClientRect()
				const scrollAdjustment = newFirstElementRect.top - oldFirstElementRect.top
				chatMessagesContainer.scrollTop = oldScrollTop + scrollAdjustment
			} else
				console.warn('[Prepend] 无法恢复精确滚动位置')
		} else {
			startIndex = newStartIndex // 即使没获取到也更新，防重试
			isLoading = false
		}
	} catch (error) {
		console.error('[Prepend] 加载更早消息出错:', error)
		isLoading = false
	} finally {
		observeSentinels() // 重新观察哨兵
	}
}

async function appendMessages() {
	const currentCount = startIndex + queue.length
	if (currentCount >= chatLogLength) {
		isLoading = false
		observeSentinels()
		return
	}
	const itemsToFetch = BUFFER_SIZE
	const numItemsToFetch = Math.min(itemsToFetch, chatLogLength - currentCount)
	const fetchStartIndex = currentCount

	try {
		const newMessages = await getChatLog(fetchStartIndex, fetchStartIndex + numItemsToFetch)
		if (newMessages && newMessages.length > 0) {
			queue = queue.concat(newMessages)
			// 如果队列过长，裁剪头部
			if (queue.length > 2 * BUFFER_SIZE) {
				const excess = queue.length - (2 * BUFFER_SIZE)
				queue = queue.slice(excess)
				startIndex += excess
			}
			await renderQueue() // 重绘 (不需要调整滚动)
		} else
			isLoading = false
	} catch (error) {
		console.error('[Append] 加载后续消息出错:', error)
		isLoading = false
	} finally {
		observeSentinels() // 重新观察哨兵
	}
}

/**
 * 更新最后一个 'char' 消息的左右箭头和滑动功能。
 */
function updateLastCharMessageArrows() {
	// 移除旧箭头
	chatMessagesContainer.querySelectorAll('.arrow').forEach(arrow => arrow.remove())

	let potentialNewSwipableElement = null // 潜在的下一个可滑动元素

	// 检查队列和最后一个消息
	if (queue.length > 0) {
		const lastMessageIndexInQueue = queue.length - 1
		const lastMessage = queue[lastMessageIndexInQueue]

		// 必须是 'char' 角色
		if (lastMessage && lastMessage.role === 'char') {
			// 获取对应的 DOM 元素 (倒数第二个子元素)
			const lastMessageElement = chatMessagesContainer.children[chatMessagesContainer.children.length - 2]

			if (lastMessageElement && !lastMessageElement.id.startsWith('sentinel')) {
				potentialNewSwipableElement = lastMessageElement // 设为候选

				const messageContent = lastMessageElement.querySelector('.message-content')
				if (messageContent) {
					// --- 添加箭头 ---
					const leftArrow = document.createElement('div')
					leftArrow.classList.add('arrow', 'left')
					leftArrow.textContent = '❮'
					messageContent.after(leftArrow)
					const rightArrow = document.createElement('div')
					rightArrow.classList.add('arrow', 'right')
					rightArrow.textContent = '❯'
					leftArrow.after(rightArrow)

					function removeArrows() { leftArrow.remove(); rightArrow.remove() }

					// --- 箭头点击事件 (修改时间线) ---
					leftArrow.addEventListener('click', async () => {
						removeArrows()
						const index = getQueueIndex(lastMessageElement); if (index === -1) return
						await stopHeartbeat()
						try {
							const modifiedMessage = await modifyTimeLine(-1) // 后退
							if (modifiedMessage) await replaceMessageInQueue(index, modifiedMessage)
							else updateLastCharMessageArrows() // 恢复箭头
						} catch (error) { updateLastCharMessageArrows() } finally { await startHeartbeat() }
					})
					rightArrow.addEventListener('click', async () => {
						removeArrows()
						const index = getQueueIndex(lastMessageElement); if (index === -1) return
						await stopHeartbeat()
						try {
							const modifiedMessage = await modifyTimeLine(1) // 前进
							if (modifiedMessage) await replaceMessageInQueue(index, modifiedMessage)
							else updateLastCharMessageArrows() // 恢复箭头
						} catch (error) { updateLastCharMessageArrows() } finally { await startHeartbeat() }
					})
					// --- 箭头逻辑结束 ---
				} else
					potentialNewSwipableElement = null // 找不到内容元素，无法添加箭头/滑动
			}
		}
	}

	// --- 管理滑动状态 ---
	if (potentialNewSwipableElement !== currentSwipableElement) {
		// 禁用旧元素的滑动
		if (currentSwipableElement) disableSwipe(currentSwipableElement)
		// 启用新元素的滑动
		if (potentialNewSwipableElement) enableSwipe(potentialNewSwipableElement)
		// 更新当前滑动元素记录
		currentSwipableElement = potentialNewSwipableElement
	}
	// --- 滑动管理结束 ---
}

export async function appendMessageToQueue(message) {
	if (!message || !observer) return

	const shouldScrollToBottom = chatMessagesContainer.scrollTop >= chatMessagesContainer.scrollHeight - chatMessagesContainer.clientHeight - 5 // Use a small tolerance
	isLoading = true

	try {
		queue.push(message)
		chatLogLength++

		if (queue.length > 2 * BUFFER_SIZE) {
			const excess = queue.length - (2 * BUFFER_SIZE)
			queue = queue.slice(excess)
			startIndex += excess
		}

		await renderQueue()

		if (shouldScrollToBottom)
			chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight
	} finally {
		observeSentinels()
	}
}


export async function replaceMessageInQueue(queueIndex, message, element = null) {
	if (queueIndex < 0 || queueIndex >= queue.length || !message) return

	queue[queueIndex] = message // 更新数据

	const elementIndexInDom = queueIndex + 1
	const oldMessageElement = chatMessagesContainer.children[elementIndexInDom]

	if (!oldMessageElement || oldMessageElement.id.startsWith('sentinel')) {
		console.error(`[Replace] 找不到 DOM 元素或元素是哨兵: queueIndex ${queueIndex}`)
		// 考虑强制重绘: isLoading = true; await renderQueue(); observeSentinels();
		return
	}

	element ??= await renderMessage(message) // 如果未提供，渲染新元素
	if (!element) {
		console.error('[Replace] renderMessage 无法生成替换元素')
		return
	}

	// 平滑替换动画
	oldMessageElement.style.transition = `opacity ${TRANSITION_DURATION / 1000}s ease-in-out`
	oldMessageElement.style.opacity = '0'
	await new Promise(resolve => setTimeout(resolve, TRANSITION_DURATION))

	try {
		oldMessageElement.replaceWith(element) // DOM 替换
	} catch (error) {
		console.error('[Replace] 替换 DOM 元素出错:', error)
		isLoading = true; await renderQueue(); observeSentinels() // 尝试重绘恢复
		return
	}

	// 如果替换的是最后一个元素，更新箭头/滑动状态
	if (queueIndex === queue.length - 1)
		updateLastCharMessageArrows()

}

export function getQueueIndex(element) {
	const elementIndexInDom = Array.from(chatMessagesContainer.children).indexOf(element)
	if (elementIndexInDom <= 0 || elementIndexInDom >= chatMessagesContainer.children.length - 1) return -1 // 不是有效消息元素 (是哨兵或未找到)
	const queueIndex = elementIndexInDom - 1
	return queueIndex >= 0 && queueIndex < queue.length ? queueIndex : -1 // 检查队列边界
}

export function getChatLogIndexByQueueIndex(queueIndex) {
	if (queueIndex < 0 || queueIndex >= queue.length) return -1
	return startIndex + queueIndex
}

export async function getMessageElementByQueueIndex(queueIndex) {
	if (queueIndex < 0 || queueIndex >= queue.length) return null
	const elementIndexInDom = queueIndex + 1
	const element = chatMessagesContainer.children[elementIndexInDom]
	return element && !element.id.startsWith('sentinel') ? element : null // 确保不是哨兵
}

export async function getMessageElementByChatLogIndex(chatLogIndex) {
	const queueIndex = chatLogIndex - startIndex
	if (queueIndex < 0 || queueIndex >= queue.length) return null // 不在当前渲染范围内
	return getMessageElementByQueueIndex(queueIndex)
}

export async function deleteMessageInQueue(queueIndex) {
	if (queueIndex < 0 || queueIndex >= queue.length || !observer) return

	const shouldScrollToBottom = chatMessagesContainer.scrollTop >= chatMessagesContainer.scrollHeight - chatMessagesContainer.clientHeight - 5
	isLoading = true

	queue.splice(queueIndex, 1) // 从数组删除
	chatLogLength--

	await renderQueue() // 重绘

	if (shouldScrollToBottom && queue.length > 0)
		chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight
	observeSentinels() // 观察新哨兵
}

export function cleanupVirtualQueueObserver() {
	if (observer) {
		observer.disconnect()
		observer = null
	}
	startIndex = 0
	queue = []
	chatLogLength = 0
	sentinelTop = null
	sentinelBottom = null
	isLoading = false
	if (currentSwipableElement)  // 清理可能存在的滑动监听器
		disableSwipe(currentSwipableElement)

	currentSwipableElement = null // 重置滑动元素记录
}
