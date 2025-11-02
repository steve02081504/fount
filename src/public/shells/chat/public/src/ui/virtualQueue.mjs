import { getChatLog, getChatLogLength } from '../../src/endpoints.mjs'
import { modifyTimeLine } from '../endpoints.mjs'
import { TRANSITION_DURATION } from '../utils.mjs'

import { renderMessage, enableSwipe, disableSwipe } from './messageList.mjs'

const chatMessagesContainer = document.getElementById('chat-messages')
const BUFFER_SIZE = 20
let startIndex = 0
/**
 * 消息队列。
 * @type {Array<object>}
 */
export let queue = []
let chatLogLength = 0

let observer = null
let sentinelTop = null
let sentinelBottom = null
let isLoading = false
let currentSwipableElement = null

/**
 * 创建一个哨兵元素。
 * @param {string} id - 哨兵元素的 ID。
 * @returns {HTMLDivElement} 创建的哨兵div元素。
 */
function createSentinel(id) {
	const sentinel = document.createElement('div')
	sentinel.id = id
	sentinel.style.height = '1px'
	sentinel.style.opacity = '0'
	sentinel.style.pointerEvents = 'none'
	return sentinel
}

/**
 * 处理交叉观察器事件。
 * @param {IntersectionObserverEntry[]} entries - 交叉观察器条目数组。
 */
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
			}
			else {
				isLoading = false
				observeSentinels() // 即使在顶部，也重新观察
			}
		else if (entry.target.id === 'sentinel-bottom') {
			const currentCount = startIndex + queue.length
			if (currentCount < chatLogLength) {
				observer.unobserve(sentinelBottom)
				await appendMessages()
			}
			else {
				isLoading = false
				observeSentinels() // 即使在底部，也重新观察
			}
		}
		else {
			isLoading = false
			console.warn(`[Intersection] 未知的哨兵目标: ${entry.target.id}`)
		}
	}
	catch (error) {
		console.error('[Intersection] 处理交叉事件出错:', error)
		isLoading = false
		observeSentinels() // 尝试恢复
	}
}

/**
 * 初始化交叉观察器。
 */
function initializeObserver() {
	if (observer) observer.disconnect()
	const options = {
		root: chatMessagesContainer,
		rootMargin: '200px 0px', // 预加载边距
		threshold: 0
	}
	observer = new IntersectionObserver(handleIntersection, options)
}

/**
 * 观察哨兵元素的交叉事件。
 */
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

/**
 * 初始化虚拟队列。
 * @param {object} initialData - 初始数据，包含日志长度和初始日志。
 */
export async function initializeVirtualQueue(initialData) {
	try {
		isLoading = true
		chatLogLength = initialData.logLength
		queue = initialData.initialLog
		startIndex = Math.max(0, chatLogLength - queue.length)

		initializeObserver()
		await renderQueue()

		chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight
	}
	finally {
		observeSentinels()
	}
}

/**
 * 渲染消息队列。
 */
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

/**
 * 从服务器加载更多消息。
 */
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
		if (newMessages?.length) {
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
			}
			else console.warn('[Prepend] 无法恢复精确滚动位置')
		}
		else {
			startIndex = newStartIndex // 即使没获取到也更新，防重试
			isLoading = false
		}
	}
	catch (error) {
		console.error('[Prepend] 加载更早消息出错:', error)
		isLoading = false
	}
	finally {
		observeSentinels() // 重新观察哨兵
	}
}

/**
 * 从服务器加载更多消息。
 */
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
		if (newMessages?.length) {
			queue = queue.concat(newMessages)
			// 如果队列过长，裁剪头部
			if (queue.length > 2 * BUFFER_SIZE) {
				const excess = queue.length - (2 * BUFFER_SIZE)
				queue = queue.slice(excess)
				startIndex += excess
			}
			await renderQueue() // 重绘 (不需要调整滚动)
		}
		else isLoading = false
	}
	catch (error) {
		console.error('[Append] 加载后续消息出错:', error)
		isLoading = false
	}
	finally {
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
	if (queue.length) {
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

					/**
					 * 移除箭头
					 */
					function removeArrows() { leftArrow.remove(); rightArrow.remove() }

					// --- 箭头点击事件 (修改时间线) ---
					leftArrow.addEventListener('click', async () => {
						removeArrows()
						await modifyTimeLine(-1) // 后退
					})
					rightArrow.addEventListener('click', async () => {
						removeArrows()
						await modifyTimeLine(1) // 前进
					})
					// --- 箭头逻辑结束 ---
				}
				else potentialNewSwipableElement = null // 找不到内容元素，无法添加箭头/滑动
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

/**
 * 将消息插入队列。
 * @param {object} message - 要插入的消息对象。
 * @returns {Promise<void>}
 */
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
	}
	finally {
		observeSentinels()
	}
}


/**
 * 替换队列中的消息。
 * @param {number} queueIndex - 队列中要替换的消息的索引。
 * @param {object} message - 新的消息对象。
 * @param {HTMLElement} [element=null] - 可选的，对应的 DOM 元素。
 */
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
	}
	catch (error) {
		console.error('[Replace] 替换 DOM 元素出错:', error)
		isLoading = true; await renderQueue(); observeSentinels() // 尝试重绘恢复
		return
	}

	// 如果替换的是最后一个元素，更新箭头/滑动状态
	if (queueIndex === queue.length - 1)
		updateLastCharMessageArrows()
}

/**
 * 获取给定元素的队列索引。
 * @param {HTMLElement} element - 要获取索引的 DOM 元素。
 * @returns {number} 元素的队列索引，如果不是有效消息元素则返回 -1。
 */
export function getQueueIndex(element) {
	const elementIndexInDom = Array.from(chatMessagesContainer.children).indexOf(element)
	if (elementIndexInDom <= 0 || elementIndexInDom >= chatMessagesContainer.children.length - 1) return -1 // 不是有效消息元素 (是哨兵或未找到)
	const queueIndex = elementIndexInDom - 1
	return queueIndex >= 0 && queueIndex < queue.length ? queueIndex : -1 // 检查队列边界
}

/**
 * 根据队列索引获取聊天日志索引。
 * @param {number} queueIndex - 队列中的索引。
 * @returns {number} 聊天日志中的索引，如果索引无效则返回 -1。
 */
export function getChatLogIndexByQueueIndex(queueIndex) {
	if (queueIndex < 0 || queueIndex >= queue.length) return -1
	return startIndex + queueIndex
}

/**
 * 根据队列索引获取消息元素。
 * @param {number} queueIndex - 队列中的索引。
 * @returns {Promise<HTMLElement|null>} 对应的消息 DOM 元素，如果不存在则为 null。
 */
export async function getMessageElementByQueueIndex(queueIndex) {
	if (queueIndex < 0 || queueIndex >= queue.length) return null
	const elementIndexInDom = queueIndex + 1
	const element = chatMessagesContainer.children[elementIndexInDom]
	return element && !element.id.startsWith('sentinel') ? element : null // 确保不是哨兵
}

/**
 * 根据聊天日志索引获取消息元素。
 * @param {number} chatLogIndex - 聊天日志中的索引。
 * @returns {Promise<HTMLElement|null>} 对应的消息 DOM 元素，如果不在当前渲染范围内则为 null。
 */
export async function getMessageElementByChatLogIndex(chatLogIndex) {
	const queueIndex = chatLogIndex - startIndex
	if (queueIndex < 0 || queueIndex >= queue.length) return null // 不在当前渲染范围内
	return getMessageElementByQueueIndex(queueIndex)
}

/**
 * 删除队列中的消息。
 * @param {number} queueIndex - 队列中要删除的消息的索引。
 * @returns {Promise<void>}
 */
export async function deleteMessageInQueue(queueIndex) {
	if (queueIndex < 0 || queueIndex >= queue.length || !observer) return

	const shouldScrollToBottom = chatMessagesContainer.scrollTop >= chatMessagesContainer.scrollHeight - chatMessagesContainer.clientHeight - 5
	isLoading = true

	queue.splice(queueIndex, 1) // 从数组删除
	chatLogLength--

	await renderQueue() // 重绘

	if (shouldScrollToBottom && queue.length)
		chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight
	observeSentinels() // 观察新哨兵
}

/**
 * 清理虚拟队列的观察者。
 */
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

// --- Handlers for websocket events ---
/**
 * 触发完全刷新。
 */
async function triggerFullRefresh() {
	try {
		isLoading = true
		chatLogLength = await getChatLogLength()
		startIndex = Math.max(0, chatLogLength - BUFFER_SIZE)
		queue = await getChatLog(startIndex, chatLogLength)

		await renderQueue()

		chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight
	}
	finally {
		observeSentinels()
	}
}

/**
 * 处理消息添加事件。
 * @param {object} message - 要添加的消息对象。
 */
export async function handleMessageAdded(message) {
	await appendMessageToQueue(message)
}

/**
 * 处理消息替换事件。
 * @param {number} index - 被替换消息的索引。
 * @param {object} message - 新的消息对象。
 * @returns {Promise<void>}
 */
export async function handleMessageReplaced(index, message) {
	const queueIndex = index - startIndex
	if (queueIndex >= 0 && queueIndex < queue.length)
		await replaceMessageInQueue(queueIndex, message)
	else {
		console.warn(`Received message replacement for index ${index}, which is outside the current view. Triggering full refresh.`)
		await triggerFullRefresh()
	}
}

/**
 * 处理消息移除事件。
 * @param {number} index - 被移除消息的索引。
 * @returns {Promise<void>}
 */
export async function handleMessageDeleted(index) {
	const queueIndex = index - startIndex
	if (queueIndex >= 0 && queueIndex < queue.length)
		await deleteMessageInQueue(queueIndex)
	else {
		console.warn(`Received message deletion for index ${index}, which is outside the current view. Triggering full refresh.`)
		await triggerFullRefresh()
	}
}
