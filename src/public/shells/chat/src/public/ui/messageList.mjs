import { renderTemplate, renderTemplateAsHtmlString } from '../../../../../scripts/template.mjs'
import { renderMarkdown } from '../../../../../scripts/markdown.mjs'
import {
	modifyTimeLine,
	deleteMessage,
	editMessage,
} from '../endpoints.mjs'
import { handleFilesSelect, renderAttachmentPreview } from '../fileHandling.mjs'
import { processTimeStampForId, SWIPE_THRESHOLD, DEFAULT_AVATAR } from '../utils.mjs'
import { appendMessageToQueue, getQueueIndex, replaceMessageInQueue, getMessageIndexByIndex, deleteMessageInQueue, getMessageElementByMessageIndex } from './virtualQueue.mjs'
import { addDragAndDropSupport } from './dragAndDrop.mjs'
import { geti18n, i18nElement } from '../../../../../scripts/i18n.mjs' // Import i18n functions

export async function renderMessage(message) {
	const preprocessedMessage = {
		...message,
		avatar: message.avatar || DEFAULT_AVATAR,
		timeStamp: new Date(message.timeStamp).toLocaleString(),
		content: await renderMarkdown(message.content),
		safeTimeStamp: processTimeStampForId(message.timeStamp)
	}

	const messageElement = await renderTemplate(
		'message_view',
		preprocessedMessage
	)
	messageElement
		.querySelector('.delete-button')
		.addEventListener('click', async () => {
			if (confirm(geti18n('chat.messageList.confirmDeleteMessage'))) { // i18n
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
		'message_edit_view',
		editRenderedMessage
	)
	i18nElement(messageElement)

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
	messageElement.addEventListener(
		'touchstart',
		(event) => {
			touchStartX = event.touches[0].clientX
		},
		{ passive: true }
	)

	messageElement.addEventListener(
		'touchend',
		async (event) => {
			const deltaX = event.changedTouches[0].clientX - touchStartX
			if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
				const index = getQueueIndex(messageElement)
				if (index === -1) return
				await replaceMessageInQueue(
					index,
					await modifyTimeLine(deltaX > 0 ? -1 : 1)
				)
			}
		},
		{ passive: true }
	)
}
