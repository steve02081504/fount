import * as Sentry from 'https://esm.sh/@sentry/browser'

import { confirmI18n, main_locale, geti18n } from '../../../../../scripts/i18n.mjs'
import { renderMarkdownAsString, renderMarkdownAsStandAloneHtmlString } from '../../../../../scripts/markdown.mjs'
import { onElementRemoved } from '../../../../../scripts/onElementRemoved.mjs'
import { renderTemplate, renderTemplateAsHtmlString, renderTemplateNoScriptActivation } from '../../../../../scripts/template.mjs'
import { showToast, showToastI18n } from '../../../../../scripts/toast.mjs'
import { stopGeneration } from '../chat.mjs'
import {
	modifyTimeLine,
	deleteMessage,
	editMessage,
	triggerCharacterReply,
	setMessageFeedback,
} from '../endpoints.mjs'
import { handleFilesSelect, renderAttachmentPreview } from '../fileHandling.mjs'
import { getfile } from '../files.mjs'
import { createShareLink } from '../share.mjs'
import { SWIPE_THRESHOLD, DEFAULT_AVATAR, TRANSITION_DURATION, arrayBufferToBase64 } from '../utils.mjs'

import { addDragAndDropSupport } from './dragAndDrop.mjs'
import {
	getQueueIndex,
	getQueue,
	replaceMessageInQueue,
	getChatLogIndexByQueueIndex,
	getMessageElementByQueueIndex,
	addDeletionListener,
} from './virtualQueue.mjs'

/**
 * 保存每个消息元素的滑动监听器，便于后续移除。
 * @type {WeakMap<HTMLElement, { touchstart: (event: TouchEvent) => void, touchmove: (event: TouchEvent) => void, touchend: (event: TouchEvent) => Promise<void>, touchcancel: () => void }>}
 */
const swipeListenersMap = new WeakMap()

/**
 * 待删除消息元素的串行队列。
 * @type {HTMLElement[]}
 */
const deletionQueue = []

/**
 * 追踪正在编辑反馈的消息状态，跨重渲染保持输入框与输入内容。
 * @type {Map<string, {type: 'up'|'down', inputValue: string}>}
 */
const activeFeedbackEdits = new Map()

/**
 * 每条消息对应的渲染缓存。
 * @type {WeakMap<object, object>}
 */
const messageRenderCacheMap = new WeakMap()

/**
 * 统一展示异步错误，避免静默失败。
 * @param {any} error - 捕获到的错误
 */
function reportAsyncError(error) {
	Sentry.captureException(error)
	showToast('error', error?.stack || error?.message || error)
}

/**
 * 获取或创建指定消息的渲染缓存对象。
 * @param {object} message - 消息对象
 * @returns {object} 渲染缓存
 */
function getMessageCache(message) {
	let cache = messageRenderCacheMap.get(message)
	if (!cache) messageRenderCacheMap.set(message, cache = {})
	return cache
}

/**
 * 按顺序处理删除队列中的下一条消息。
 */
async function processDeletionQueue() {
	const messageElement = deletionQueue.shift()
	if (!messageElement) return
	try {
		const queueIndex = getQueueIndex(messageElement)
		if (queueIndex === -1) return
		const chatLogIndex = getChatLogIndexByQueueIndex(queueIndex)
		const uiUpdated = new Promise(resolve => addDeletionListener(resolve))
		await deleteMessage(chatLogIndex)
		await uiUpdated
	}
	catch (error) {
		console.error('Error processing deletion:', error)
		reportAsyncError(error)
	}
}
setTimeout(async function loop() {
	await processDeletionQueue()
	setTimeout(loop, 1000)
})

/**
 * 将消息元素加入删除队列，等待后台串行处理。
 * @param {HTMLElement} messageElement - 要删除的消息元素
 */
function enqueueDeletion(messageElement) {
	deletionQueue.push(messageElement)
}

/**
 * 生成可离线查看的完整消息 HTML 文档。
 * @param {object} message - 消息对象
 * @param {object} [cache] - 渲染缓存（与普通渲染共享）
 * @returns {Promise<string>} 完整 HTML 字符串
 */
async function generateFullHtmlForMessage(message, cache) {
	return renderTemplateAsHtmlString('standalone_message', {
		main_locale,
		message,
		/**
		 * 将 Markdown 渲染为独立 HTML 字符串。
		 * @param {string} markdown - Markdown 文本
		 * @returns {Promise<string>} HTML 字符串
		 */
		renderMarkdownAsStandAloneHtmlString: markdown => renderMarkdownAsStandAloneHtmlString(markdown, cache),
		geti18n,
		getfile,
		arrayBufferToBase64,
	})
}

/**
 * 渲染单条消息元素。
 * @param {object} message - 消息对象。
 * @returns {Promise<HTMLElement>} - 渲染好的消息 DOM 元素。
 */
export async function renderMessage(message) {
	const cache = getMessageCache(message)

	const preprocessedMessage = {
		...message,
		avatar: message.avatar || DEFAULT_AVATAR,
		time_stamp: new Date(message.time_stamp).toLocaleString(),
		content: await renderMarkdownAsString(message.content_for_show || message.content, cache),
	}

	if (message.is_generating) {
		const messageElement = await renderTemplateNoScriptActivation('message_generating_view', preprocessedMessage)
		// Add stop button listener
		const stopButton = messageElement.querySelector('.stop-generating-button')
		if (stopButton)
			stopButton.addEventListener('click', () => {
				stopGeneration(message.id)
			})

		const skeleton = messageElement.querySelector('.skeleton-loader')
		const content = messageElement.querySelector('.message-content')
		if (skeleton && content)
			if (!preprocessedMessage.content || !preprocessedMessage.content.trim()) {
				skeleton.classList.remove('hidden')
				content.classList.add('hidden')
			} else {
				skeleton.classList.add('hidden')
				content.classList.remove('hidden')
			}

		return messageElement
	}

	const messageElement = await renderTemplate('message_view', preprocessedMessage)
	const messageContentElement = messageElement.querySelector('.message-content')
	const messageMarkdownContent = message.content_for_show || message.content

	// --- 拖放下载功能 ---
	const standaloneMessageUrl = URL.createObjectURL(new Blob([await generateFullHtmlForMessage(message, cache)], { type: 'text/html' }))
	onElementRemoved(messageElement, () => {
		URL.revokeObjectURL(standaloneMessageUrl)
	})

	messageElement.addEventListener('mousedown', e => {
		// If the mousedown is on an interactive part, don't make the message draggable.
		// This allows text selection, button clicks, etc.
		if (e.target.closest('.message-content, textarea'))
			messageElement.draggable = false
		else // Otherwise, allow dragging the whole message.
			messageElement.draggable = true
	})

	/**
	 * 清理可拖拽状态以防止意外行为。
	 * @returns {void}
	 */
	const cleanupDraggable = () => { messageElement.draggable = false }
	messageElement.addEventListener('mouseup', cleanupDraggable)
	messageElement.addEventListener('mouseleave', cleanupDraggable)
	messageElement.addEventListener('dragend', cleanupDraggable)

	messageElement.addEventListener('dragstart', event => {
		const fileName = `message-${message.id}.html`

		event.dataTransfer.setData('DownloadURL', `text/html:${fileName}:${standaloneMessageUrl}`)
		event.dataTransfer.effectAllowed = 'copy'

		event.dataTransfer.setData('text/plain', messageContentElement.textContent.trim())
		event.dataTransfer.setData('text/markdown', message.content)
		event.dataTransfer.setData('text/html', preprocessedMessage.content)
	})

	// --- 删除按钮 ---
	const deleteButtons = messageElement.querySelectorAll('.delete-button')
	deleteButtons.forEach(deleteButton => {
		deleteButton.addEventListener('click', () => {
			// Count lines in the message content
			const lineCount = messageMarkdownContent.split('\n').length
			// Skip confirmation for messages with less than 30 lines
			const needsConfirmation = lineCount >= 30

			if (!needsConfirmation || confirmI18n('chat.messageList.confirmDeleteMessage')) {
				deleteButtons.forEach(btn => btn.disabled = true)
				enqueueDeletion(messageElement)
			}
		})
	})

	// --- Shift 键切换按钮组 ---
	const buttonGroup = messageElement.querySelector('.button-group')
	const normalButtons = buttonGroup.querySelector('.normal-buttons')
	const shiftButtons = buttonGroup.querySelector('.shift-buttons')
	let isShiftPressed = false

	/**
	 * 根据 Shift 按键状态切换按钮组显示。
	 */
	const updateButtonVisibility = () => {
		if (isShiftPressed) {
			normalButtons.style.display = 'none'
			shiftButtons.style.display = 'flex'
		} else {
			normalButtons.style.display = 'flex'
			shiftButtons.style.display = 'none'
		}
	}
	/**
	 * 处理 Shift 按下事件。
	 * @param {KeyboardEvent} e - 键盘事件
	 */
	const handleKeyDown = (e) => {
		if (e.key !== 'Shift' || isShiftPressed) return
		isShiftPressed = true
		updateButtonVisibility()
	}
	/**
	 * 处理 Shift 松开事件。
	 * @param {KeyboardEvent} e - 键盘事件
	 */
	const handleKeyUp = (e) => {
		if (e.key !== 'Shift' || !isShiftPressed) return
		isShiftPressed = false
		updateButtonVisibility()
	}
	/**
	 * 处理失去焦点事件。
	 * @returns {void}
	 */
	const handleBlur = () => {
		if (!isShiftPressed) return
		isShiftPressed = false
		updateButtonVisibility()
	}

	document.addEventListener('keydown', handleKeyDown)
	document.addEventListener('keyup', handleKeyUp)
	window.addEventListener('blur', handleBlur)
	onElementRemoved(messageElement, () => {
		document.removeEventListener('keydown', handleKeyDown)
		document.removeEventListener('keyup', handleKeyUp)
		window.removeEventListener('blur', handleBlur)
	})
	updateButtonVisibility()

	// --- Direct Download HTML button (shift mode) ---
	/**
	 * 下载当前消息为独立 HTML 文件。
	 * @returns {void}
	 */
	const triggerDownload = () => {
		const a = Object.assign(document.createElement('a'), {
			href: standaloneMessageUrl,
			download: `message-${message.id}.html`,
		})
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
	}
	messageElement.querySelector('.download-html-button-direct').addEventListener('click', triggerDownload)

	// 获取 dropdown 菜单元素
	const dropdownMenu = messageElement.querySelector('.dropdown')
	messageElement.addEventListener('mouseleave', () => dropdownMenu.hidePopover())

	// 获取 dropdown items
	dropdownMenu.querySelector('.copy-markdown-button').addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(messageMarkdownContent)
		} catch (error) { reportAsyncError(error) }
		dropdownMenu.hidePopover()
	})
	dropdownMenu.querySelector('.copy-text-button').addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(messageContentElement.textContent.trim())
		} catch (error) { reportAsyncError(error) }
		dropdownMenu.hidePopover()
	})
	dropdownMenu.querySelector('.copy-html-button').addEventListener('click', async () => {
		try {
			const fullHtml = await generateFullHtmlForMessage(message, cache)
			await navigator.clipboard.writeText(fullHtml)
		} catch (error) { reportAsyncError(error) }
		dropdownMenu.hidePopover()
	})

	// --- Download as HTML button ---
	dropdownMenu.querySelector('.download-html-button').addEventListener('click', () => {
		triggerDownload()
		dropdownMenu.hidePopover()
	})

	// --- Share buttons ---
	const shareButtons = dropdownMenu.querySelectorAll('.share-button')
	shareButtons.forEach(button => {
		button.addEventListener('click', async () => {
			try {
				const { time } = button.dataset
				showToastI18n('info', 'chat.messageView.share.uploading')
				const blob = new Blob([await generateFullHtmlForMessage(message)], { type: 'text/html' })
				const link = await createShareLink(blob, `message-${message.id}.html`, time)

				await navigator.clipboard.writeText(link)
				showToastI18n('success', 'chat.messageView.share.success', {
					provider: 'litterbox.moe',
					sponsorLink: 'https://store.catbox.moe/'
				})
			}
			catch (error) {
				reportAsyncError(error)
			}
			dropdownMenu.hidePopover()
		})
	})

	// --- 编辑按钮 ---
	const editButton = messageElement.querySelector('.edit-button')
	editButton.addEventListener('click', async () => {
		const queueIndex = getQueueIndex(messageElement)
		if (queueIndex === -1) return
		const chatLogIndex = getChatLogIndexByQueueIndex(queueIndex)
		if (chatLogIndex === -1) return
		await editMessageStart(message, queueIndex, chatLogIndex) // 显示编辑界面
	})

	// --- 消息反馈栏（仅角色消息）---
	const feedbackBar = messageElement.querySelector('[data-feedback-bar]')
	if (feedbackBar) {
		const feedbackUp = feedbackBar.querySelector('.feedback-up')
		const feedbackDown = feedbackBar.querySelector('.feedback-down')
		const regenerateBtn = feedbackBar.querySelector('.regenerate-btn')
		const inputWrap = feedbackBar.querySelector('[data-feedback-input-wrap]')
		const feedbackInput = feedbackBar.querySelector('[data-feedback-input]')
		const feedbackSubmit = feedbackBar.querySelector('[data-feedback-submit]')
		const feedbackCancel = feedbackBar.querySelector('[data-feedback-cancel]')

		/**
		 * 展示反馈原因输入框并记录当前反馈类型。
		 * @param {'up'|'down'} type - 反馈类型
		 */
		const showFeedbackInput = (type) => {
			inputWrap?.classList.add('visible')
			feedbackInput?.focus()
			feedbackInput?.setAttribute('data-pending-type', type)
		}
		/**
		 * 隐藏原因输入框并清理挂起状态与编辑追踪。
		 */
		const hideFeedbackInput = () => {
			inputWrap?.classList.remove('visible')
			feedbackInput?.removeAttribute('data-pending-type')
			activeFeedbackEdits.delete(message.id)
		}

		/**
		 * 根据已保存的反馈状态还原按钮颜色。
		 */
		const restoreButtonColors = () => {
			const savedType = message.extension?.feedback?.type
			feedbackUp?.classList.toggle('text-success', savedType === 'up')
			feedbackDown?.classList.toggle('text-error', savedType === 'down')
		}

		/**
		 * 提交反馈到服务器。本地状态仅在 API 成功后更新。
		 * @param {'up'|'down'} type - 反馈类型
		 * @param {string} [content] - 可选说明
		 * @returns {Promise<void>}
		 */
		const doFeedback = async (type, content) => {
			const queueIndex = getQueueIndex(messageElement)
			if (queueIndex === -1) return
			const chatLogIndex = getChatLogIndexByQueueIndex(queueIndex)
			if (chatLogIndex === -1) return
			const feedback = { type, content: content?.trim() || undefined }
			await setMessageFeedback(chatLogIndex, feedback)
			message.extension ??= {}
			message.extension.feedback = feedback
		}

		/**
		 * 点击按钮时展示原因输入框，但不立即提交反馈。
		 * @param {'up'|'down'} type - 反馈类型
		 */
		const handleFeedbackClick = (type) => {
			feedbackUp?.classList.toggle('text-success', type === 'up')
			feedbackDown?.classList.toggle('text-error', type === 'down')
			if (feedbackInput) feedbackInput.value = ''
			showFeedbackInput(type)
			activeFeedbackEdits.set(message.id, { type, inputValue: '' })
		}
		feedbackUp?.addEventListener('click', () => handleFeedbackClick('up'))
		feedbackDown?.addEventListener('click', () => handleFeedbackClick('down'))
		regenerateBtn?.addEventListener('click', () => {
			modifyTimeLine(Infinity).catch(reportAsyncError)
		})

		/**
		 * 关闭输入框并提交含原因的反馈。
		 * 先隐藏表单再提交——确保重渲染时表单已隐藏，不会闪烁。
		 * @param {string} [content] - 可选反馈原因
		 */
		const closeFeedbackAndSubmit = (content) => {
			const type = feedbackInput?.getAttribute('data-pending-type')
			if (type !== 'up' && type !== 'down') return
			hideFeedbackInput()
			doFeedback(type, content).catch(reportAsyncError)
		}
		feedbackSubmit?.addEventListener('click', () => closeFeedbackAndSubmit(feedbackInput?.value))
		feedbackCancel?.addEventListener('click', () => {
			hideFeedbackInput()
			restoreButtonColors()
		})
		feedbackInput?.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && e.ctrlKey) {
				e.preventDefault()
				closeFeedbackAndSubmit(feedbackInput?.value)
			}
			else if (e.key === 'Escape') {
				hideFeedbackInput()
				restoreButtonColors()
			}
		})

		feedbackInput?.addEventListener('input', () => {
			const edit = activeFeedbackEdits.get(message.id)
			if (edit) edit.inputValue = feedbackInput.value
		})

		// 重渲染后恢复活跃的反馈编辑状态
		const activeEdit = activeFeedbackEdits.get(message.id)
		if (activeEdit) {
			showFeedbackInput(activeEdit.type)
			if (feedbackInput) feedbackInput.value = activeEdit.inputValue || ''
		}
	}

	// --- 渲染附件 ---
	if (message.files?.length) {
		const attachmentsContainer = messageElement.querySelector('.attachments')
		if (attachmentsContainer) {
			if (message.files.length === 1)
				attachmentsContainer.classList.add('is-single-attachment')

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

	return messageElement
}

/**
 * 判断用户消息编辑确认后应执行的后续动作。
 * 当编辑的消息是最后一条用户消息且其后只有零条或一条角色回复时，返回对应的动作类型。
 * @param {object} message - 被编辑的消息对象。
 * @param {number} queueIndex - 该消息在队列中的索引。
 * @returns {'trigger-reply'|'modify-timeline'|null} 后续动作类型，null 表示无需额外操作。
 */
function getPostEditActionForUserMessage(message, queueIndex) {
	if (message.role !== 'user') return null
	const queue = getQueue()
	const messagesAfter = queue.slice(queueIndex + 1)
	if (messagesAfter.some(m => m.role === 'user')) return null
	const charCount = messagesAfter.filter(m => m.role === 'char').length
	if (charCount === 0) return 'trigger-reply'
	if (charCount === 1) return 'modify-timeline'
	return null
}

/**
 * 开始编辑指定消息。
 * @param {object} message - 原始消息。
 * @param {number} queueIndex - 在队列中的索引。
 * @param {number} chatLogIndex - 在聊天记录中的绝对索引。
 */
export async function editMessageStart(message, queueIndex, chatLogIndex) {
	const selectedFiles = [...message.files ?? []]
	const editRenderedMessage = {
		...message,
		avatar: message.avatar || DEFAULT_AVATAR,
		time_stamp: new Date(message.time_stamp).toLocaleString(),
		content_for_edit: message.content_for_edit || message.content, // 编辑专用内容
	}

	const messageElement = await getMessageElementByQueueIndex(queueIndex)
	if (!messageElement) return

	// 平滑过渡：淡出
	messageElement.style.transition = `opacity ${TRANSITION_DURATION / 1000}s ease-in-out`
	messageElement.style.opacity = '0'
	await new Promise(resolve => setTimeout(resolve, TRANSITION_DURATION))

	// 渲染编辑视图并替换
	const editViewHtml = await renderTemplateAsHtmlString('message_edit_view', editRenderedMessage)
	messageElement.innerHTML = editViewHtml

	// 获取编辑视图元素
	const fileEditInput = messageElement.querySelector(`#file-edit-input-${message.id}`)
	const attachmentPreview = messageElement.querySelector(`#attachment-edit-preview-${message.id}`)
	const editInput = messageElement.querySelector(`#edit-input-${message.id}`)
	const confirmButton = messageElement.querySelector(`#confirm-button-${message.id}`)
	const cancelButton = messageElement.querySelector(`#cancel-button-${message.id}`)
	const uploadButton = messageElement.querySelector(`#upload-edit-button-${message.id}`)

	// 添加拖拽上传支持
	addDragAndDropSupport(editInput, selectedFiles, attachmentPreview)

	// keyboard shortcuts for editing
	editInput.addEventListener('keydown', event => {
		if (event.key === 'Enter' && event.ctrlKey) {
			event.preventDefault() // Prevent newline
			event.stopPropagation() // Prevent bubbling
			confirmButton.click()
		}
		else if (event.key === 'Escape') {
			event.preventDefault() // Prevent default action
			event.stopPropagation() // Prevent bubbling
			cancelButton.click()
		}
	})

	// --- 确认编辑 ---
	confirmButton.addEventListener('click', async () => {
		const newMessage = { ...message, content: editInput.value, files: selectedFiles }
		const postEditAction = getPostEditActionForUserMessage(message, queueIndex)
		await editMessage(chatLogIndex, newMessage)
		if (postEditAction === 'trigger-reply')
			triggerCharacterReply(null).catch(reportAsyncError)
		else if (postEditAction === 'modify-timeline')
			modifyTimeLine(Infinity).catch(reportAsyncError)
	})

	// --- 取消编辑 ---
	cancelButton.addEventListener('click', async () => {
		await replaceMessageInQueue(queueIndex, message) // 恢复原始消息视图
	})

	// --- 渲染编辑状态的附件 ---
	attachmentPreview.innerHTML = ''
	const attachmentPromises = selectedFiles.map((file, i) =>
		renderAttachmentPreview(file, i, selectedFiles) // 传入 selectedFiles 以支持删除
	)
	const renderedAttachments = await Promise.all(attachmentPromises)
	renderedAttachments.forEach(el => { if (el) attachmentPreview.appendChild(el) })

	// --- 编辑状态上传按钮 ---
	uploadButton.addEventListener('click', () => fileEditInput.click())

	// --- 文件选择处理 ---
	fileEditInput.addEventListener('change', event =>
		handleFilesSelect(event, selectedFiles, attachmentPreview) // 更新 selectedFiles 和预览
	)

	// 平滑过渡：淡入
	messageElement.style.opacity = '1'

	// 自动聚焦并移动光标到末尾
	editInput.focus()
	editInput.setSelectionRange(editInput.value.length, editInput.value.length)
}

/**
 * 公开接口：替换指定索引的消息。
 * @param {number} queueIndex - 队列中的索引
 * @param {object} message - 消息对象
 * @returns {Promise<void>}
 */
export const replaceMessage = replaceMessageInQueue

/**
 * 为消息元素启用左右滑动切换时间线的功能。
 * @param {HTMLElement} messageElement - 需要启用滑动的消息 DOM 元素。
 */
export function enableSwipe(messageElement) {
	if (swipeListenersMap.has(messageElement)) disableSwipe(messageElement) // 防重复添加

	let touchStartX = 0, touchStartY = 0, isDragging = false, swipeHandled = false

	/**
	 * 记录触摸起点并初始化滑动状态。
	 * @param {TouchEvent} event - 触摸开始事件
	 */
	const handleTouchStart = event => {
		if (event.touches.length !== 1) return
		touchStartX = event.touches[0].clientX
		touchStartY = event.touches[0].clientY
		isDragging = true
		swipeHandled = false
	}
	/**
	 * 在触摸移动过程中判断是否仍视为横向滑动。
	 * @param {TouchEvent} event - 触摸移动事件
	 */
	const handleTouchMove = event => {
		if (!isDragging || event.touches.length !== 1) return
		const deltaX = event.touches[0].clientX - touchStartX
		const deltaY = event.touches[0].clientY - touchStartY
		if (Math.abs(deltaY) > Math.abs(deltaX)) isDragging = false
	}
	/**
	 * 在触摸结束时触发时间线切换逻辑。
	 * @param {TouchEvent} event - 触摸结束事件
	 */
	const handleTouchEnd = async event => {
		if (!isDragging || swipeHandled || event.changedTouches.length !== 1) { isDragging = false; return }
		const deltaX = event.changedTouches[0].clientX - touchStartX
		const deltaY = event.changedTouches[0].clientY - touchStartY
		isDragging = false
		if (Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY)) {
			if (checkForHorizontalScrollbar(event.target)) return
			swipeHandled = true
			await modifyTimeLine(deltaX > 0 ? -1 : 1) // 右滑后退，左滑前进
		}
	}
	/**
	 * 触摸流程被系统中断时重置拖拽状态。
	 */
	const handleTouchCancel = () => { isDragging = false }

	/**
	 * 递归检查元素是否有水平滚动条（避免误触发滑动）
	 * @param {HTMLElement} element - 要检查的元素
	 * @returns {boolean} 是否包含水平滚动条
	 */
	function checkForHorizontalScrollbar(element) {
		if (!element || !element.scrollWidth || !element.clientWidth) return false
		if (element.scrollWidth > element.clientWidth) return true
		for (let i = 0; i < element.children.length; i++)
			if (checkForHorizontalScrollbar(element.children[i])) return true
		return false
	}

	const listeners = { touchstart: handleTouchStart, touchmove: handleTouchMove, touchend: handleTouchEnd, touchcancel: handleTouchCancel }
	swipeListenersMap.set(messageElement, listeners)
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
	if (!listeners) return
	// 移除事件监听
	messageElement.removeEventListener('touchstart', listeners.touchstart)
	messageElement.removeEventListener('touchmove', listeners.touchmove)
	messageElement.removeEventListener('touchend', listeners.touchend)
	messageElement.removeEventListener('touchcancel', listeners.touchcancel)
	swipeListenersMap.delete(messageElement) // 清除引用
}
