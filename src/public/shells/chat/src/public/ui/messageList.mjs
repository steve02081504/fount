import { renderTemplate, renderTemplateAsHtmlString } from '../../../../../scripts/template.mjs'
import { renderMarkdownAsString } from '../../../../../scripts/markdown.mjs'
import {
	modifyTimeLine,
	deleteMessage,
	editMessage,
} from '../endpoints.mjs'
import { handleFilesSelect, renderAttachmentPreview } from '../fileHandling.mjs'
import { processTimeStampForId, SWIPE_THRESHOLD, DEFAULT_AVATAR } from '../utils.mjs'
import { appendMessageToQueue, getQueueIndex, replaceMessageInQueue, getMessageIndexByIndex, deleteMessageInQueue, getMessageElementByMessageIndex } from './virtualQueue.mjs'
import { addDragAndDropSupport } from './dragAndDrop.mjs'
import { geti18n } from '../../../../../scripts/i18n.mjs'

export async function renderMessage(message) {
	const preprocessedMessage = {
		...message,
		avatar: message.avatar || DEFAULT_AVATAR,
		timeStamp: new Date(message.timeStamp).toLocaleString(),
		content: await renderMarkdownAsString(message.content_for_show || message.content),
		safeTimeStamp: processTimeStampForId(message.timeStamp)
	}

	const messageElement = await renderTemplate(
		'chat/message_view',
		preprocessedMessage
	)
	messageElement
		.querySelector('.delete-button')
		.addEventListener('click', async () => {
			if (confirm(geti18n('chat.messageList.confirmDeleteMessage'))) {
				const index = getQueueIndex(messageElement)
				if (index === -1) return
				const messageIndex = await getMessageIndexByIndex(index)
				await deleteMessage(messageIndex)
				messageElement.remove()
				await deleteMessageInQueue(index)
			}
		})

	messageElement
		.querySelector('.edit-button')
		.addEventListener('click', async () => {
			const index = getQueueIndex(messageElement)
			if (index === -1) return
			const messageIndex = await getMessageIndexByIndex(index)
			await editMessageStart(message, index, messageIndex)
		})

	if (message.files?.length > 0) {
		const attachmentsContainer = messageElement.querySelector('.attachments')
		message.files.forEach(async (file, index) => {
			attachmentsContainer.appendChild(
				await renderAttachmentPreview(file, index, null)
			)
		})
	}

	if (message.role == 'char') {
		enableSwipe(messageElement)
		if (document.visibilityState != 'visible' && Notification?.permission == 'granted')
			new Notification(message.name, {
				body: message.content,
				icon: message.avatar
			})
	}

	return messageElement
}

export async function editMessageStart(message, index, messageIndex) {
	const selectedFiles = message.files || []
	const editRenderedMessage = {
		...message,
		avatar: message.avatar || DEFAULT_AVATAR,
		timeStamp: new Date(message.timeStamp).toLocaleString(),
		content_for_edit: message.content_for_edit || message.content,
		safeTimeStamp: processTimeStampForId(message.timeStamp),
	}
	const messageElement = await getMessageElementByMessageIndex(messageIndex)
	messageElement.innerHTML = await renderTemplateAsHtmlString(
		'chat/message_edit_view',
		editRenderedMessage
	)

	const fileEditInputElement = messageElement.querySelector(
		`#file-edit-input-${editRenderedMessage.safeTimeStamp}`
	)
	const attachmentEditPreviewContainer = messageElement.querySelector(
		`#attachment-edit-preview-${editRenderedMessage.safeTimeStamp}`
	)

	// 添加拖拽上传支持
	addDragAndDropSupport(
		messageElement.querySelector(
			`#edit-input-${editRenderedMessage.safeTimeStamp}`
		),
		selectedFiles,
		attachmentEditPreviewContainer
	)

	messageElement
		.querySelector(`#confirm-button-${editRenderedMessage.safeTimeStamp}`)
		.addEventListener('click', async () => {
			const newContent = messageElement.querySelector(
				`#edit-input-${editRenderedMessage.safeTimeStamp}`
			).value
			const newMessage = {
				...message,
				content: newContent,
				files: selectedFiles
			}
			const updatedMessage = await editMessage(messageIndex, newMessage)
			await replaceMessageInQueue(index, updatedMessage)
			await renderMessage(updatedMessage) // re-render the message to update view
		})

	messageElement
		.querySelector(`#cancel-button-${editRenderedMessage.safeTimeStamp}`)
		.addEventListener('click', async () => {
			await replaceMessageInQueue(index, message)
			await renderMessage(message) // re-render the message to update view
		})

	selectedFiles.forEach(async (file, i) => {
		attachmentEditPreviewContainer.appendChild(
			await renderAttachmentPreview(file, i, selectedFiles)
		)
	})

	messageElement
		.querySelector(`#upload-edit-button-${editRenderedMessage.safeTimeStamp}`)
		.addEventListener('click', () => fileEditInputElement.click())

	fileEditInputElement.addEventListener('change', (event) =>
		handleFilesSelect(event, selectedFiles, attachmentEditPreviewContainer)
	)

	messageElement
		.querySelector(`#edit-input-${editRenderedMessage.safeTimeStamp}`)
		.focus()
}

export async function appendMessage(message) {
	await appendMessageToQueue(message)
}

export async function replaceMessage(index, message) {
	await replaceMessageInQueue(index, message)
}

export function enableSwipe(messageElement) {
	let touchStartX = 0
	let touchStartY = 0
	let hasHorizontalScrollbar = false

	messageElement.addEventListener('touchstart', (event) => {
		touchStartX = event.touches[0].clientX
		touchStartY = event.touches[0].clientY
		function checkForScrollbar(element) {
			if (element.scrollWidth > element.clientWidth)
				return true
			for (let i = 0; i < element.children.length; i++)
				if (checkForScrollbar(element.children[i]))
					return true
			return false
		}

		hasHorizontalScrollbar = checkForScrollbar(event.target)
	}, { passive: true })

	messageElement.addEventListener('touchend', async (event) => {
		const deltaX = event.changedTouches[0].clientX - touchStartX
		const deltaY = event.changedTouches[0].clientY - touchStartY

		if (
			Math.abs(deltaX) > SWIPE_THRESHOLD &&
			Math.abs(deltaY) < Math.abs(deltaX)
		)
			// Simplified logic: Only allow swipe if NO scrollbar was detected anywhere.
			if (!hasHorizontalScrollbar) {
				const index = getQueueIndex(messageElement)
				if (index === -1) return
				await replaceMessageInQueue(
					index,
					await modifyTimeLine(deltaX > 0 ? -1 : 1)
				)
			}
	}, { passive: true })
}
