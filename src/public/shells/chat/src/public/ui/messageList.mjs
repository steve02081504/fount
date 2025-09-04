import { confirmI18n } from '../../../../../scripts/i18n.mjs'
import { renderMarkdownAsString } from '../../../../../scripts/markdown.mjs'
import { sendNotification } from '../../../../../scripts/sendNotification.mjs'
import { renderTemplate, renderTemplateAsHtmlString } from '../../../../../scripts/template.mjs'
import { showToast } from '../../../../../scripts/toast.mjs'
import {
	modifyTimeLine,
	deleteMessage,
	editMessage,
} from '../endpoints.mjs'
import { handleFilesSelect, renderAttachmentPreview } from '../fileHandling.mjs'
import { processTimeStampForId, SWIPE_THRESHOLD, DEFAULT_AVATAR } from '../utils.mjs'

import { addDragAndDropSupport } from './dragAndDrop.mjs'
import {
	appendMessageToQueue,
	getQueueIndex,
	replaceMessageInQueue,
	getChatLogIndexByQueueIndex,
	deleteMessageInQueue,
	getMessageElementByQueueIndex,
} from './virtualQueue.mjs'

// 用于存储滑动事件监听器的 Map
const swipeListenersMap = new WeakMap()

/**
 * 渲染单条消息元素。
 * @param {object} message - 消息对象。
 * @returns {Promise<HTMLElement>} - 渲染好的消息 DOM 元素。
 */
export async function renderMessage(message) {
	const preprocessedMessage = {
		...message,
		avatar: message.avatar || DEFAULT_AVATAR,
		time_stamp: new Date(message.time_stamp).toLocaleString(),
		content: await renderMarkdownAsString(message.content_for_show || message.content),
		safeTimeStamp: processTimeStampForId(message.time_stamp)
	}

	const messageElement = await renderTemplate('message_view', preprocessedMessage)

	// --- 删除按钮 ---
	const deleteButton = messageElement.querySelector('.delete-button')
	if (deleteButton)
		deleteButton.addEventListener('click', async () => {
			if (confirmI18n('chat.messageList.confirmDeleteMessage')) {
				const queueIndex = getQueueIndex(messageElement)
				if (queueIndex === -1) return
				const chatLogIndex = getChatLogIndexByQueueIndex(queueIndex)
				if (chatLogIndex === -1) return
				await deleteMessage(chatLogIndex)
				await deleteMessageInQueue(queueIndex) // virtualQueue 处理移除和重绘
			}
		})

	// 获取 dropdown 菜单元素
	const dropdownMenu = messageElement.querySelector('.dropdown')
	if (dropdownMenu) {
		// 获取消息内容
		const messageContentElement = messageElement.querySelector('.message-content')
		const messageMarkdownContent = message.content_for_show || message.content

		// 获取 dropdown items
		dropdownMenu.querySelector('.copy-markdown-button').addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(messageMarkdownContent)
			} catch (error) { showToast(error, 'error') }
			dropdownMenu.hidePopover()
		})
		dropdownMenu.querySelector('.copy-text-button').addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(messageContentElement.textContent.trim())
			} catch (error) { showToast(error, 'error') }
			dropdownMenu.hidePopover()
		})
		dropdownMenu.querySelector('.copy-html-button').addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(messageContentElement.innerHTML.trim())
			} catch (error) { showToast(error, 'error') }
			dropdownMenu.hidePopover()
		})
	}

	// --- 编辑按钮 ---
	const editButton = messageElement.querySelector('.edit-button')
	if (editButton)
		editButton.addEventListener('click', async () => {
			const queueIndex = getQueueIndex(messageElement)
			if (queueIndex === -1) return
			const chatLogIndex = getChatLogIndexByQueueIndex(queueIndex)
			if (chatLogIndex === -1) return
			await editMessageStart(message, queueIndex, chatLogIndex) // 显示编辑界面
		})

	// --- 渲染附件 ---
	if (message.files?.length > 0) {
		const attachmentsContainer = messageElement.querySelector('.attachments')
		if (attachmentsContainer) {
			attachmentsContainer.innerHTML = ''
			const attachmentPromises = message.files.map((file, index) =>
				renderAttachmentPreview(file, index, null)
			)
			const renderedAttachments = await Promise.all(attachmentPromises)
			renderedAttachments.forEach(attachmentElement => {
				if (attachmentElement) attachmentsContainer.appendChild(attachmentElement)
			})
		}
	}

	// --- 特殊处理 'char' 消息 ---
	if (message.role == 'char')
		// 桌面通知 (如果页面在后台)
		if (document.visibilityState != 'visible')
			sendNotification(message.name ?? 'Character', {
				body: message.content,
				icon: message.avatar || DEFAULT_AVATAR
			})

	return messageElement
}

/**
 * 开始编辑指定消息。
 * @param {object} message - 原始消息。
 * @param {number} queueIndex - 在队列中的索引。
 * @param {number} chatLogIndex - 在聊天记录中的绝对索引。
 */
export async function editMessageStart(message, queueIndex, chatLogIndex) {
	const selectedFiles = [...message.files || []] // 文件副本
	const editRenderedMessage = {
		...message,
		avatar: message.avatar || DEFAULT_AVATAR,
		time_stamp: new Date(message.time_stamp).toLocaleString(),
		content_for_edit: message.content_for_edit || message.content, // 编辑专用内容
		safeTimeStamp: processTimeStampForId(message.time_stamp),
	}

	const messageElement = await getMessageElementByQueueIndex(queueIndex)
	if (!messageElement) return

	// 渲染编辑视图并替换
	const editViewHtml = await renderTemplateAsHtmlString('message_edit_view', editRenderedMessage)
	messageElement.innerHTML = editViewHtml

	// 获取编辑视图元素
	const fileEditInput = messageElement.querySelector(`#file-edit-input-${editRenderedMessage.safeTimeStamp}`)
	const attachmentPreview = messageElement.querySelector(`#attachment-edit-preview-${editRenderedMessage.safeTimeStamp}`)
	const editInput = messageElement.querySelector(`#edit-input-${editRenderedMessage.safeTimeStamp}`)
	const confirmButton = messageElement.querySelector(`#confirm-button-${editRenderedMessage.safeTimeStamp}`)
	const cancelButton = messageElement.querySelector(`#cancel-button-${editRenderedMessage.safeTimeStamp}`)
	const uploadButton = messageElement.querySelector(`#upload-edit-button-${editRenderedMessage.safeTimeStamp}`)

	// 添加拖拽上传支持
	if (editInput && attachmentPreview)
		addDragAndDropSupport(editInput, selectedFiles, attachmentPreview)


	// --- 确认编辑 ---
	if (confirmButton && editInput)
		confirmButton.addEventListener('click', async () => {
			const newMessage = { ...message, content: editInput.value, files: selectedFiles }
			const updatedMessage = await editMessage(chatLogIndex, newMessage) // 后端编辑
			await replaceMessageInQueue(queueIndex, updatedMessage) // 更新队列和 DOM
		})


	// --- 取消编辑 ---
	if (cancelButton)
		cancelButton.addEventListener('click', async () => {
			await replaceMessageInQueue(queueIndex, message) // 恢复原始消息视图
		})


	// --- 渲染编辑状态的附件 ---
	if (attachmentPreview) {
		attachmentPreview.innerHTML = ''
		const attachmentPromises = selectedFiles.map((file, i) =>
			renderAttachmentPreview(file, i, selectedFiles) // 传入 selectedFiles 以支持删除
		)
		const renderedAttachments = await Promise.all(attachmentPromises)
		renderedAttachments.forEach(el => { if (el) attachmentPreview.appendChild(el) })
	}

	// --- 编辑状态上传按钮 ---
	if (uploadButton && fileEditInput)
		uploadButton.addEventListener('click', () => fileEditInput.click())


	// --- 文件选择处理 ---
	if (fileEditInput && attachmentPreview)
		fileEditInput.addEventListener('change', event =>
			handleFilesSelect(event, selectedFiles, attachmentPreview) // 更新 selectedFiles 和预览
		)


	// 自动聚焦并移动光标到末尾
	if (editInput) {
		editInput.focus()
		editInput.setSelectionRange(editInput.value.length, editInput.value.length)
	}
}

/**
 * 公开接口：添加消息到末尾。
 * @param {object} message - 消息对象。
 */
export async function appendMessage(message) {
	await appendMessageToQueue(message)
}

/**
 * 公开接口：替换指定索引的消息。
 * @param {number} index - 队列索引 (queueIndex)。
 * @param {object} message - 新消息对象。
 */
export async function replaceMessage(index, message) {
	await replaceMessageInQueue(index, message)
}

/**
 * 为消息元素启用左右滑动切换时间线的功能。
 * @param {HTMLElement} messageElement - 需要启用滑动的消息 DOM 元素。
 */
export function enableSwipe(messageElement) {
	if (swipeListenersMap.has(messageElement)) disableSwipe(messageElement) // 防重复添加

	let touchStartX = 0, touchStartY = 0, isDragging = false, swipeHandled = false

	// --- 定义命名的监听器函数 ---
	const handleTouchStart = event => {
		if (event.touches.length !== 1) return
		touchStartX = event.touches[0].clientX
		touchStartY = event.touches[0].clientY
		isDragging = true
		swipeHandled = false
	}
	const handleTouchMove = event => {
		if (!isDragging || event.touches.length !== 1) return
		const deltaX = event.touches[0].clientX - touchStartX
		const deltaY = event.touches[0].clientY - touchStartY
		if (Math.abs(deltaY) > Math.abs(deltaX)) isDragging = false // 垂直滚动优先
	}
	const handleTouchEnd = async event => {
		if (!isDragging || swipeHandled || event.changedTouches.length !== 1) { isDragging = false; return }
		const deltaX = event.changedTouches[0].clientX - touchStartX
		const deltaY = event.changedTouches[0].clientY - touchStartY
		isDragging = false

		if (Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY)) {
			const targetElement = event.target
			if (checkForHorizontalScrollbar(targetElement)) return // 忽略带水平滚动的元素

			swipeHandled = true
			const index = getQueueIndex(messageElement); if (index === -1) return
			const direction = deltaX > 0 ? -1 : 1 // 右滑-1(后退), 左滑+1(前进)
			const modifiedMessage = await modifyTimeLine(direction)
			if (modifiedMessage) await replaceMessageInQueue(index, modifiedMessage)
		}
	}
	const handleTouchCancel = () => { isDragging = false }
	function checkForHorizontalScrollbar(element) {
		if (!element || !element.scrollWidth || !element.clientWidth) return false
		if (element.scrollWidth > element.clientWidth) return true
		for (let i = 0; i < element.children.length; i++)
			if (checkForHorizontalScrollbar(element.children[i])) return true

		return false
	}
	// --- 监听器定义结束 ---

	const listeners = { touchstart: handleTouchStart, touchmove: handleTouchMove, touchend: handleTouchEnd, touchcancel: handleTouchCancel }
	swipeListenersMap.set(messageElement, listeners) // 存储监听器引用

	// 添加事件监听
	messageElement.addEventListener('touchstart', listeners.touchstart, { passive: true })
	messageElement.addEventListener('touchmove', listeners.touchmove, { passive: true })
	messageElement.addEventListener('touchend', listeners.touchend, { passive: true })
	messageElement.addEventListener('touchcancel', listeners.touchcancel, { passive: true })
}

/**
 * 从消息元素移除左右滑动功能。
 * @param {HTMLElement} messageElement - 需要禁用滑动的消息 DOM 元素。
 */
export function disableSwipe(messageElement) {
	const listeners = swipeListenersMap.get(messageElement)
	if (listeners) {
		// 移除事件监听
		messageElement.removeEventListener('touchstart', listeners.touchstart)
		messageElement.removeEventListener('touchmove', listeners.touchmove)
		messageElement.removeEventListener('touchend', listeners.touchend)
		messageElement.removeEventListener('touchcancel', listeners.touchcancel)
		swipeListenersMap.delete(messageElement) // 清除引用
	}
}
