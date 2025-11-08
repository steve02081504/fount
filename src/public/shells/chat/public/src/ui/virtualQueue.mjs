import { createVirtualList } from '../../../../scripts/virtualList.mjs'
import { getChatLog, getChatLogLength } from '../../src/endpoints.mjs'
import { modifyTimeLine } from '../endpoints.mjs'
import { processTimeStampForId } from '../utils.mjs'

import { renderMessage, enableSwipe, disableSwipe } from './messageList.mjs'

const chatMessagesContainer = document.getElementById('chat-messages')

let virtualList = null
let currentSwipableElement = null
const deletionListeners = []

/**
 * 添加一个在从 UI 中删除消息后将被调用的监听器。
 * @param {Function} callback - 要调用的函数。
 */
export function addDeletionListener(callback) {
	deletionListeners.push(callback)
}

/**
 * 通知所有已注册的删除监听器。
 */
function notifyDeletionListeners() {
	while (deletionListeners.length) deletionListeners.pop()()
}

/**
 * 更新最后一个 'char' 消息的左右箭头和滑动功能。
 */
function updateLastCharMessageArrows() {
	// 移除旧箭头和滑动功能
	chatMessagesContainer.querySelectorAll('.arrow').forEach(arrow => arrow.remove())
	if (currentSwipableElement) {
		disableSwipe(currentSwipableElement)
		currentSwipableElement = null
	}

	const queue = virtualList.getQueue()
	if (!queue.length) return

	const lastMessageIndexInQueue = queue.length - 1
	const lastMessage = queue[lastMessageIndexInQueue]

	if (lastMessage && lastMessage.role === 'char') {
		const lastMessageElement = document.getElementById(`message-${processTimeStampForId(lastMessage.time_stamp)}`)

		if (lastMessageElement) {
			currentSwipableElement = lastMessageElement
			const messageContent = lastMessageElement.querySelector('.message-content')

			if (messageContent) {
				enableSwipe(lastMessageElement)

				const leftArrow = document.createElement('div')
				leftArrow.classList.add('arrow', 'left')
				leftArrow.textContent = '❮'
				messageContent.after(leftArrow)

				const rightArrow = document.createElement('div')
				rightArrow.classList.add('arrow', 'right')
				rightArrow.textContent = '❯'
				leftArrow.after(rightArrow)

				/**
				 * 移除左右箭头
				 */
				const removeArrows = () => { leftArrow.remove(); rightArrow.remove() }
				leftArrow.addEventListener('click', async () => { removeArrows(); await modifyTimeLine(-1) })
				rightArrow.addEventListener('click', async () => { removeArrows(); await modifyTimeLine(1) })
			}
		}
	}
}

/**
 * 初始化虚拟队列。
 * @param {object} initialData - 初始数据 (不再使用，但保留函数签名以防万一).
 */
export async function initializeVirtualQueue(initialData) {
	if (virtualList)
		virtualList.destroy()

	const total = await getChatLogLength()

	virtualList = createVirtualList({
		container: chatMessagesContainer,
		/**
		 * 从服务器获取聊天记录数据块。
		 * @param {number} offset - 数据块的起始索引。
		 * @param {number} limit - 数据块的大小。
		 * @returns {Promise<{items: Array<object>, total: number}>} 包含项目和总数的对象。
		 */
		fetchData: async (offset, limit) => {
			// 直接使用已获取的总数，避免在每次请求时都重复获取
			const items = await getChatLog(offset, offset + limit)
			return { items, total }
		},
		renderItem: renderMessage,
		// 从最后一个项目开始
		initialIndex: total > 0 ? total - 1 : 0,
		onRenderComplete: updateLastCharMessageArrows,
	})
}

/**
 * 替换队列中的消息。
 * @param {number} queueIndex - 队列中要替换的消息的索引。
 * @param {object} message - 新的消息对象。
 */
export async function replaceMessageInQueue(queueIndex, message) {
	if (!virtualList) return
	const logIndex = virtualList.getChatLogIndexByQueueIndex(queueIndex)
	await virtualList.replaceItem(logIndex, message)
}

/**
 * 获取给定元素的队列索引。
 * @param {HTMLElement} element - 要获取索引的 DOM 元素。
 * @returns {number} 元素的队列索引，如果不是有效消息元素则返回 -1。
 */
export function getQueueIndex(element) {
	return virtualList ? virtualList.getQueueIndex(element) : -1
}

/**
 * 根据队列索引获取聊天日志索引。
 * @param {number} queueIndex - 队列中的索引。
 * @returns {number} 聊天日志中的索引，如果索引无效则返回 -1。
 */
export function getChatLogIndexByQueueIndex(queueIndex) {
	return virtualList ? virtualList.getChatLogIndexByQueueIndex(queueIndex) : -1
}

/**
 * 根据队列索引获取消息元素。
 * @param {number} queueIndex - 队列中的索引。
 * @returns {Promise<HTMLElement|null>} 对应的消息 DOM 元素，如果不存在则为 null。
 */
export async function getMessageElementByQueueIndex(queueIndex) {
	if (!virtualList || queueIndex < 0 || queueIndex >= virtualList.getQueue().length) return null
	const elementIndexInDom = queueIndex + 1 // +1 for sentinel-top
	const element = chatMessagesContainer.children[elementIndexInDom]
	return element && !element.id.startsWith('sentinel') ? element : null
}

/**
 * 清理虚拟队列的观察者。
 */
export function cleanupVirtualQueueObserver() {
	if (virtualList) {
		virtualList.destroy()
		virtualList = null
	}
	if (currentSwipableElement) {
		disableSwipe(currentSwipableElement)
		currentSwipableElement = null
	}
}

// --- Handlers for websocket events ---

/**
 * 触发虚拟列表的完全刷新。
 */
async function triggerFullRefresh() {
	if (virtualList) {
		await virtualList.refresh()
		chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight
	}
}

/**
 * 处理消息添加事件。
 * @param {object} message - 要添加的消息对象。
 */
export async function handleMessageAdded(message) {
	if (!virtualList) return
	// 仅当用户滚动到底部时才自动滚动到新消息
	const shouldScroll = chatMessagesContainer.scrollTop >= chatMessagesContainer.scrollHeight - chatMessagesContainer.clientHeight - 20
	await virtualList.appendItem(message, shouldScroll)
}

/**
 * 处理消息替换事件。
 * @param {number} index - 被替换消息的日志索引。
 * @param {object} message - 新的消息对象。
 */
export async function handleMessageReplaced(index, message) {
	if (!virtualList) return
	await virtualList.replaceItem(index, message)
}

/**
 * 处理消息移除事件。
 * @param {number} index - 被移除消息的日志索引。
 */
export async function handleMessageDeleted(index) {
	if (!virtualList) return
	await virtualList.deleteItem(index)
	notifyDeletionListeners()
}

/**
 * 从队列中删除消息（通过刷新实现）。
 * @param {number} queueIndex - 要删除的消息的队列索引。
 */
export async function deleteMessageInQueue(queueIndex) {
	await handleMessageDeleted(virtualList.getChatLogIndexByQueueIndex(queueIndex))
}
/**
 * 获取当前渲染的消息队列。
 * @returns {Array<object>} 当前队列数组。
 */
export function getQueue() {
	return virtualList ? virtualList.getQueue() : []
}
